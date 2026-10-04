import { randomUUID } from 'node:crypto';
import type {
  AccessDecision,
  AgentContext,
  AgentKind,
  DialogueAuthor,
  HandoffBrief,
  ReturnShape,
  Run,
  RunStep,
  TaskPlan,
} from '../domain';
import {
  CURSOR_CLI_MISSING_AUTH_MESSAGE,
  isAgentCliAvailable,
  runCursorCliStep,
} from './cursor-cli';
import type { CliTrace } from './cursor-cli-stream';
import { CursorClient } from './cursor-client';
import type { CursorConnectionMode } from '../domain';
import { writeProjectMap } from './project-folder';
import { briefLine, roleTurn } from './role-turn';
import { SimulatedAgent } from './simulated-agent';
import {
  archiveResult,
  buildFromPlan,
  draftPlan,
  formatPlan,
  lookNote,
  reviewAgainst,
  taskDirectory,
  writeTaskArchive,
  writeTaskPieces,
  type PieceMode,
} from './task-order';
import { recordCursorStepUsage } from './cursor-usage';
import { ShellApprovalRequiredError } from './shell-allow';
import { normalizeAccessPath } from './workspace-trust';

type RunOptions = {
  delayMs?: number;
  cursorConnected: boolean;
  live: boolean;
  cursorMode: CursorConnectionMode;
  cursorToken: string | null;
  resolveCliAuth?: () => Promise<{ ready: boolean; apiKey: string | null }>;
  projectFolder: string | null;
  workspaceFile: string | null;
  isWorkspaceTrusted?: (path: string) => boolean;
  grantWorkspaceAlways?: (path: string) => void;
  isShellAllowed?: (base: string, folder: string) => boolean;
  grantShellAlways?: (base: string, folder: string) => void;
  /** С какого шага продолжать. Пусто — с начала. */
  startAtStep?: number;
  resumeMode?: 'continue' | 'retry';
  /** Текст обрыва для нового промпта, если тот же чат CLI недоступен. */
  retryError?: string | null;
};

export function readDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SIM_DELAY_MS;
  if (raw === undefined || raw.trim() === '') return 1100;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 1100;
  return Math.min(value, 10_000);
}

const ROLE_KINDS = new Set<AgentKind>([
  'orchestrator',
  'analyst',
  'architect',
  'developer',
  'tester',
]);

function cwdFolder(options: {
  projectFolder: string | null;
  workspaceFile: string | null;
}): string {
  if (options.projectFolder?.trim()) return options.projectFolder.trim();
  const file = options.workspaceFile?.trim();
  if (!file) return '';
  const slash = file.lastIndexOf('/');
  return slash > 0 ? file.slice(0, slash) : '';
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function continuationNote(run: Run, error: string | null): string {
  const done = run.work
    .map((item) => `${item.agentName} / ${item.title}: ${item.summary}`)
    .filter((line) => line.trim())
    .join('\n');
  return [
    error?.trim() ? `Прошлый обрыв: ${error.trim()}` : '',
    done ? `Уже сделано:\n${done}` : '',
    'Продолжай этот шаг. Готовые шаги не переделывай.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function say(step: RunStep, author: DialogueAuthor, text: string): void {
  step.messages.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    author,
    text,
  });
}

function contextFor(run: Run, index: number): AgentContext {
  const step = run.steps[index];
  const previous = index > 0 ? run.steps[index - 1] : undefined;
  return {
    agentName: step.agentName,
    title: step.title,
    instructions: step.instructions,
    skills: step.skills,
    task: run.task,
    priorWork: run.work.map((item) => ({
      title: item.title,
      agentName: item.agentName,
      output: item.output,
    })),
    incomingHandoff: previous ? previous.handoff : null,
    outgoingHandoff: step.handoff,
    isFinalStep: index === run.steps.length - 1,
    requiresApproval: step.mode === 'approval',
    kind: step.kind,
    brief: step.brief,
    answer: null,
    project: run.project,
    developerShape: run.developerShape,
    developerPasses: 0,
  };
}

/**
 * Ведёт одну задачу по отдельным диалогам.
 * Вопрос роли останавливает конвейер, пока не ответит владелец.
 * Оркестратор за владельца не отвечает и карту пишет только в конце.
 */
export class Orchestrator {
  private readonly gates = new Map<string, (approved: boolean) => void>();
  private readonly answers = new Map<string, (text: string) => void>();
  private readonly plans = new Map<string, (plan: TaskPlan) => void>();
  private readonly accessGates = new Map<
    string,
    (decision: AccessDecision) => void
  >();
  /** «Один раз»: папка доверена только до конца этого запуска. */
  private readonly sessionTrusts = new Map<string, Set<string>>();
  /** «Один раз»: первое слово команды до конца этого запуска. */
  private readonly sessionShells = new Map<string, Set<string>>();
  /** Тот же объект, который ведёт цикл. Останов пишет в него сразу, не дожидаясь микрозадачи. */
  private readonly liveRuns = new Map<string, Run>();
  /** Текст, которым владелец оборвал запуск. Пока он есть, цикл не идёт дальше. */
  private readonly halted = new Map<string, string>();
  private readonly simulated = new SimulatedAgent();
  private readonly cursor = new CursorClient();

  constructor() {}

  /** Разрешает или отклоняет текущую точку проверки. */
  decide(runId: string, approved: boolean): boolean {
    const resolve = this.gates.get(runId);
    if (!resolve) return false;
    if (!approved) {
      const run = this.liveRuns.get(runId);
      if (run) {
        this.halted.set(runId, 'Владелец отклонил шаг.');
        this.markHalted(run);
      }
    }
    this.gates.delete(runId);
    resolve(approved);
    return true;
  }

  /** Живой запуск, если цикл ещё его держит. */
  peek(runId: string): Run | null {
    return this.liveRuns.get(runId) ?? null;
  }

  /** Ожидание уже висит в памяти этого процесса. */
  hasWaiter(runId: string): boolean {
    return (
      this.gates.has(runId) ||
      this.answers.has(runId) ||
      this.plans.has(runId) ||
      this.accessGates.has(runId)
    );
  }

  /**
   * После рестарта процесса вопрос, план и доступ остаются в запуске,
   * а промис ожидания — нет. Вешает его сразу и продолжает шаг после решения.
   */
  bindSavedWait(
    run: Run,
    publish: (run: Run) => void,
    options: RunOptions,
  ): boolean {
    if (this.hasWaiter(run.id)) return true;
    if (this.liveRuns.has(run.id)) return false;
    const index = run.stepIndex ?? 0;
    const step = run.steps[index];
    if (run.status === 'waiting_user') {
      if (!step || !run.pendingQuestion) return false;
      this.arm(run);
      const pending = new Promise<string>((resolve) => {
        this.answers.set(run.id, resolve);
      });
      this.bound(run, publish, async () => {
        const answer = await pending;
        const tell = () => publish(structuredClone(run));
        if (this.halted.has(run.id)) {
          this.markHalted(run);
          tell();
          return;
        }
        const answeredAt = new Date().toISOString();
        say(step, 'user', answer.trim());
        run.status = 'running';
        run.pendingQuestion = null;
        run.updatedAt = answeredAt;
        run.events.push({
          id: randomUUID(),
          at: answeredAt,
          kind: 'question',
          message: `Владелец ответил в диалоге «${step.title}».`,
          stepIndex: index,
        });
        tell();
        const passes = run.work.filter(
          (item) => item.stepId === step.stepId,
        ).length;
        const second = await this.speak(
          run,
          step,
          index,
          run.steps[index - 1]?.brief ?? null,
          answer.trim(),
          passes,
        );
        if (this.halted.has(run.id)) {
          this.markHalted(run);
          tell();
          return;
        }
        say(step, 'role', second.text);
        step.brief = second.handoff;
        step.mapAddition = second.mapAddition ?? step.mapAddition;
        step.question = null;
        this.finishWork(run, step, answeredAt, second.text);
        if (step.mode === 'approval') {
          const rejected = await this.waitApproval(run, step, index, tell);
          if (rejected) return;
        }
        await this.executeSteps(run, publish, {
          ...options,
          startAtStep: index + 1,
        });
      });
      return true;
    }
    if (run.status === 'waiting_approval') {
      if (!step) return false;
      this.arm(run);
      const pending = new Promise<boolean>((resolve) => {
        this.gates.set(run.id, resolve);
      });
      this.bound(run, publish, async () => {
        const approved = await pending;
        const tell = () => publish(structuredClone(run));
        if (this.halted.has(run.id)) {
          this.markHalted(run);
          tell();
          return;
        }
        const decidedAt = new Date().toISOString();
        run.updatedAt = decidedAt;
        if (!approved) {
          run.status = 'failed';
          run.error = 'Владелец отклонил шаг.';
          run.finishedAt = decidedAt;
          run.events.push({
            id: randomUUID(),
            at: decidedAt,
            kind: 'error',
            message: run.error,
            stepIndex: index,
          });
          tell();
          return;
        }
        run.status = 'running';
        run.events.push({
          id: randomUUID(),
          at: decidedAt,
          kind: 'approval',
          message: `Владелец подтвердил «${step.title}».`,
          stepIndex: index,
        });
        tell();
        await this.executeSteps(run, publish, {
          ...options,
          startAtStep: index + 1,
        });
      });
      return true;
    }
    if (run.status === 'waiting_access') {
      if (!run.pendingAccess) return false;
      this.arm(run);
      const pending = new Promise<AccessDecision>((resolve) => {
        this.accessGates.set(run.id, resolve);
      });
      this.bound(run, publish, async () => {
        const decision = await pending;
        const tell = () => publish(structuredClone(run));
        const request = run.pendingAccess;
        run.pendingAccess = null;
        if (this.halted.has(run.id) || decision === 'deny') {
          if (decision === 'deny' && !this.halted.has(run.id)) {
            const reason =
              request?.kind === 'shell'
                ? `Владелец не разрешил команду: ${request.command ?? request.path}`
                : 'Владелец не разрешил доступ к папке проекта.';
            this.halted.set(run.id, reason);
          }
          this.markHalted(run);
          tell();
          return;
        }
        const folder = options.projectFolder?.trim() || cwdFolder(options);
        if (decision === 'always') {
          if (request?.kind === 'workspace')
            options.grantWorkspaceAlways?.(request.path);
          if (request?.kind === 'shell')
            options.grantShellAlways?.(request.path, folder);
        }
        if (decision === 'once') {
          if (request?.kind === 'workspace') {
            const granted = this.sessionTrusts.get(run.id) ?? new Set<string>();
            granted.add(request.path);
            this.sessionTrusts.set(run.id, granted);
          }
          if (request?.kind === 'shell') {
            const granted = this.sessionShells.get(run.id) ?? new Set<string>();
            granted.add(request.path);
            this.sessionShells.set(run.id, granted);
          }
        }
        const decidedAt = new Date().toISOString();
        run.status = 'running';
        run.updatedAt = decidedAt;
        run.events.push({
          id: randomUUID(),
          at: decidedAt,
          kind: 'approval',
          message:
            request?.kind === 'shell'
              ? decision === 'always'
                ? `Команда «${request.path}» разрешена постоянно.`
                : `Команда «${request.path}» разрешена на этот запуск.`
              : decision === 'always'
                ? `Папка ${request?.path ?? ''} разрешена постоянно.`
                : `Папка ${request?.path ?? ''} разрешена на этот запуск.`,
          stepIndex: index,
        });
        tell();
        await this.executeSteps(run, publish, {
          ...options,
          startAtStep: index,
          resumeMode: 'continue',
          retryError: null,
        });
      });
      return true;
    }
    if (run.status === 'waiting_plan') {
      this.arm(run);
      const pending = new Promise<TaskPlan>((resolve) => {
        this.plans.set(run.id, resolve);
      });
      this.bound(run, publish, async () => {
        const edited = await pending;
        const tell = () => publish(structuredClone(run));
        if (this.halted.has(run.id)) {
          this.markHalted(run);
          tell();
          return;
        }
        run.plan = edited;
        this.persistPieces(run);
        const acceptedAt = new Date().toISOString();
        run.updatedAt = acceptedAt;
        const planIndex = run.steps.findIndex((item) => item.mode === 'plan');
        run.events.push({
          id: randomUUID(),
          at: acceptedAt,
          kind: 'progress',
          message: 'План принят. Сборка берёт его в контекст.',
          stepIndex: planIndex >= 0 ? planIndex : null,
        });
        tell();
        await this.completeDeep(
          run,
          tell,
          options.delayMs ?? readDelayMs(),
          edited,
        );
      });
      return true;
    }
    return false;
  }

  /**
   * Обрывает ожидание и сразу помечает запуск неуспешным.
   * Возвращает живой объект или null, если цикла уже нет.
   */
  requestHalt(runId: string, reason: string): Run | null {
    const run = this.liveRuns.get(runId);
    if (!run) return null;
    if (run.status === 'completed' || run.status === 'failed') return run;
    this.halted.set(runId, reason);
    this.markHalted(run);
    this.releaseWaiters(runId);
    return run;
  }

  /** Кладёт ответ владельца в диалог роли, которая спросила. */
  answer(runId: string, text: string): boolean {
    const resolve = this.answers.get(runId);
    if (!resolve) return false;
    this.answers.delete(runId);
    resolve(text);
    return true;
  }

  /** Всегда, один раз на этот запуск, или отказ. */
  grantAccess(runId: string, decision: AccessDecision): boolean {
    const resolve = this.accessGates.get(runId);
    if (!resolve) return false;
    this.accessGates.delete(runId);
    if (decision === 'deny') {
      const run = this.liveRuns.get(runId);
      if (run) {
        const pending = run.pendingAccess;
        const reason =
          pending?.kind === 'shell'
            ? `Владелец не разрешил команду: ${pending.command ?? pending.path}`
            : 'Владелец не разрешил доступ к папке проекта.';
        this.halted.set(runId, reason);
        this.markHalted(run);
      }
    }
    resolve(decision);
    return true;
  }

  /** Принимает план, который владелец поправил перед сборкой. */
  revise(runId: string, plan: TaskPlan): boolean {
    const resolve = this.plans.get(runId);
    if (!resolve) return false;
    this.plans.delete(runId);
    resolve(plan);
    return true;
  }

  async execute(
    run: Run,
    publish: (run: Run) => void,
    options: RunOptions,
  ): Promise<void> {
    this.liveRuns.set(run.id, run);
    try {
      if (run.deepThinking) {
        await this.executeDeep(
          run,
          publish,
          options.delayMs ?? readDelayMs(),
          Boolean(options.resumeMode),
        );
        return;
      }
      await this.executeSteps(run, publish, options);
    } finally {
      this.release(run.id);
    }
  }

  private async executeSteps(
    run: Run,
    publish: (run: Run) => void,
    options: RunOptions,
  ): Promise<void> {
    const delayMs = options.delayMs ?? readDelayMs();
    const tell = () => publish(structuredClone(run));
    const startAt = Math.max(
      0,
      Math.min(options.startAtStep ?? 0, run.steps.length),
    );
    let incoming: HandoffBrief | null =
      startAt > 0 ? (run.steps[startAt - 1]?.brief ?? null) : null;
    let resume =
      options.resumeMode && startAt < run.steps.length
        ? { mode: options.resumeMode, error: options.retryError ?? null }
        : null;
    try {
      let index = startAt;
      let guard = 0;
      while (index < run.steps.length) {
        guard += 1;
        if (guard > 12) {
          throw new Error('Задача зациклилась между ролями.');
        }
        const step = run.steps[index];
        incoming = await this.runStep(
          run,
          index,
          incoming,
          tell,
          delayMs,
          options,
          resume,
        );
        resume = null;
        if (run.status === 'failed' || this.halted.has(run.id)) return;
        const sendBack =
          step.kind === 'tester' &&
          step.brief?.now.startsWith('Разработчику вернуть');
        if (sendBack) {
          const developer = run.steps.findIndex(
            (item) => item.kind === 'developer',
          );
          const passes = run.work.filter(
            (item) => item.stepId === run.steps[developer]?.stepId,
          ).length;
          if (developer >= 0 && passes < 2) {
            index = developer;
            continue;
          }
        }
        index += 1;
      }
      this.closeMap(run);
      const last = run.work[run.work.length - 1];
      const ended = new Date().toISOString();
      run.status = 'completed';
      run.stepIndex = null;
      run.pendingQuestion = null;
      run.finalResult = last?.output ?? run.mapNote ?? '';
      run.finishedAt = ended;
      run.updatedAt = ended;
      run.events.push({
        id: randomUUID(),
        at: ended,
        kind: 'done',
        message: 'Запуск завершён.',
        stepIndex: null,
      });
      tell();
    } catch (error) {
      if (this.halted.has(run.id)) {
        this.markHalted(run);
        tell();
        return;
      }
      const failedAt = new Date().toISOString();
      this.gates.delete(run.id);
      this.answers.delete(run.id);
      this.plans.delete(run.id);
      this.accessGates.delete(run.id);
      run.status = 'failed';
      run.pendingQuestion = null;
      run.pendingAccess = null;
      run.error =
        error instanceof Error ? error.message : 'Шаг завершился ошибкой.';
      run.finishedAt = failedAt;
      run.updatedAt = failedAt;
      run.events.push({
        id: randomUUID(),
        at: failedAt,
        kind: 'error',
        message: run.error,
        stepIndex: run.stepIndex,
      });
      tell();
    }
  }

  private async runStep(
    run: Run,
    index: number,
    incoming: HandoffBrief | null,
    tell: () => void,
    delayMs: number,
    options: RunOptions,
    resume: { mode: 'continue' | 'retry'; error: string | null } | null,
  ): Promise<HandoffBrief | null> {
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return incoming;
    }
    const step = run.steps[index];
    const started = new Date().toISOString();
    const continuing =
      resume?.mode === 'continue' &&
      step.messages.some((message) => message.text.trim().length > 0);
    run.status = 'running';
    run.stepIndex = index;
    run.pendingQuestion = null;
    run.pendingAccess = null;
    run.updatedAt = started;
    const viaCursor = step.harness === 'cursor';
    const note = viaCursor
      ? options.live
        ? options.cursorMode === 'cli'
          ? `${step.agentName} ведёт «${step.title}» через локальный CLI Cursor в папке проекта.`
          : `${step.agentName} ведёт «${step.title}» через Cloud Agents API Cursor.`
        : options.cursorMode === 'api' && !options.cursorConnected
          ? `${step.agentName} не может вызвать Cursor: токен не задан.`
          : options.cursorMode === 'cli' && !options.cursorConnected
            ? `${step.agentName} не может вызвать Cursor: на сервере нужны CLI «agent» и вход или ключ CURSOR_API_KEY.`
            : `${step.agentName} не может вызвать Cursor: живой режим выключен (CURSOR_LIVE=0).`
      : `${step.agentName} открыл новый диалог «${step.title}».`;
    if (!continuing) {
      run.events.push({
        id: randomUUID(),
        at: started,
        kind: 'progress',
        message: note,
        stepIndex: index,
      });
      if (incoming) say(step, 'handoff', briefLine(incoming));
      if (step.kind === 'orchestrator' && step.mode === 'question') {
        say(step, 'user', run.task.trim());
      }
    }
    tell();
    await sleep(delayMs);
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return step.brief;
    }

    if (viaCursor) {
      if (!options.live || !this.cursor.liveEnabled()) {
        throw new Error(
          'Нельзя выполнить шаг Cursor: живой вызов отключён переменной CURSOR_LIVE=0 на сервере.',
        );
      }
      if (options.cursorMode === 'api') {
        if (!options.cursorConnected || !options.cursorToken) {
          throw new Error(
            'Нельзя выполнить шаг Cursor: API-токен не сохранён на сервере. Задайте токен в настройках.',
          );
        }
      } else {
        if (!isAgentCliAvailable()) {
          throw new Error(
            'Нельзя выполнить шаг Cursor: на сервере не найден CLI «agent». Установите Cursor CLI и добавьте его в PATH на машине, где работает backend.',
          );
        }
        if (!options.projectFolder && !options.workspaceFile) {
          throw new Error(
            'Нельзя выполнить шаг Cursor: не указана папка проекта или workspace на сервере.',
          );
        }
      }
    }

    const passes = run.work.filter(
      (item) => item.stepId === step.stepId,
    ).length;
    let first;
    if (viaCursor && options.live) {
      let cliApiKey: string | null = null;
      if (options.cursorMode === 'cli') {
        const cliAuth = options.resolveCliAuth
          ? await options.resolveCliAuth()
          : { ready: false, apiKey: null };
        if (!cliAuth.ready) {
          throw new Error(CURSOR_CLI_MISSING_AUTH_MESSAGE);
        }
        cliApiKey = cliAuth.apiKey;
        const folder =
          options.workspaceFile?.trim() || options.projectFolder?.trim() || '';
        const allowed = await this.allowWorkspace(
          run,
          folder,
          index,
          tell,
          options,
        );
        if (!allowed) return step.brief;
      }
      if (resume?.mode === 'retry') step.cliSessionId = null;
      const sessionId =
        resume?.mode === 'continue' ? step.cliSessionId?.trim() || null : null;
      const retryNote = resume
        ? sessionId
          ? 'Продолжи тот же диалог. Сервер перезапустился, этот шаг ещё не закончен.'
          : continuationNote(run, resume.error)
        : null;
      const stepInput = {
        token: options.cursorToken ?? '',
        task: run.task,
        stepTitle: step.title,
        agentName: step.agentName,
        instructions: step.instructions,
        skills: step.skills,
        projectFolder: options.projectFolder,
        workspaceFile: options.workspaceFile,
        resumeChatId: sessionId,
        retryNote,
      };
      let lastTraceTell = 0;
      const onTrace = (trace: CliTrace) => {
        say(step, 'trace', trace.text);
        const now = Date.now();
        if (trace.kind === 'tool' || now - lastTraceTell >= 400) {
          lastTraceTell = now;
          tell();
        }
      };
      const onSession = (id: string) => {
        if (step.cliSessionId === id) return;
        step.cliSessionId = id;
        tell();
      };
      const projectDir = options.projectFolder?.trim() || cwdFolder(options);
      let cursorResult;
      if (options.cursorMode === 'cli') {
        for (;;) {
          try {
            cursorResult = await runCursorCliStep(
              stepInput,
              process.env,
              cliApiKey,
              {
                trust: true,
                onTrace,
                onSession,
                shellAllowed: (base) =>
                  this.shellBaseAllowed(run.id, base, projectDir, options),
                sessionShellBases: [...(this.sessionShells.get(run.id) ?? [])],
              },
            );
            break;
          } catch (error) {
            if (!(error instanceof ShellApprovalRequiredError)) throw error;
            const allowed = await this.allowShell(
              run,
              error.command,
              error.base,
              projectDir,
              index,
              tell,
              options,
            );
            if (!allowed) return step.brief;
          }
        }
      } else {
        cursorResult = await this.cursor.runStep(stepInput);
      }
      if (cursorResult.cliSessionId?.trim()) {
        step.cliSessionId = cursorResult.cliSessionId.trim();
      }
      tell();
      const link =
        cursorResult.agentUrl != null
          ? ` Ссылка: ${cursorResult.agentUrl}.`
          : '';
      const via =
        options.cursorMode === 'cli' ? 'Cursor CLI' : 'Cloud Agents API';
      run.events.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        kind: 'progress',
        message: `${via} ответил на «${step.title}».${link}`,
        stepIndex: index,
      });
      if (cursorResult.usageCapture) {
        recordCursorStepUsage(
          run,
          {
            stepId: step.stepId,
            title: step.title,
            agentName: step.agentName,
          },
          cursorResult.usageCapture,
        );
      }
      tell();
      first = {
        text: cursorResult.text,
        handoff: {
          goal: run.task.split('\n')[0] ?? run.task,
          decided: cursorResult.text.slice(0, 240),
          now: step.handoff || 'Дальше по процессу.',
        },
        mapAddition: null,
        question: null,
        shape: 'none' as ReturnShape,
        sentBack: false,
        fixedTest: false,
      };
    } else {
      first = await this.speak(run, step, index, incoming, null, passes);
    }
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return step.brief;
    }
    say(step, 'role', first.text);
    step.mapAddition = first.mapAddition;
    if (first.shape !== 'none') run.developerShape = first.shape;

    if (
      step.mode === 'question' &&
      first.question &&
      step.kind !== 'orchestrator'
    ) {
      step.question = first.question;
      run.pendingQuestion = first.question;
      run.status = 'waiting_user';
      run.updatedAt = new Date().toISOString();
      run.events.push({
        id: randomUUID(),
        at: run.updatedAt,
        kind: 'question',
        message: `«${step.title}» ждёт ответа владельца.`,
        stepIndex: index,
      });
      tell();
      const answer = await new Promise<string>((resolve) => {
        this.answers.set(run.id, resolve);
      });
      if (this.halted.has(run.id)) {
        // Отказ от вопроса не дописывает работу и не пускает роли дальше.
        // Иначе возврат разработчику добавил бы проходы сверх списка шагов.
        this.markHalted(run);
        tell();
        return step.brief;
      }
      const answeredAt = new Date().toISOString();
      say(step, 'user', answer.trim());
      run.status = 'running';
      run.pendingQuestion = null;
      run.updatedAt = answeredAt;
      run.events.push({
        id: randomUUID(),
        at: answeredAt,
        kind: 'question',
        message: `Владелец ответил в диалоге «${step.title}».`,
        stepIndex: index,
      });
      tell();
      const second = await this.speak(
        run,
        step,
        index,
        incoming,
        answer.trim(),
        passes,
      );
      if (this.halted.has(run.id)) {
        this.markHalted(run);
        tell();
        return step.brief;
      }
      say(step, 'role', second.text);
      step.brief = second.handoff;
      step.mapAddition = second.mapAddition ?? step.mapAddition;
      step.question = null;
      this.finishWork(run, step, started, second.text);
    } else {
      step.brief = first.handoff;
      step.question = null;
      this.finishWork(run, step, started, first.text);
    }

    if (step.mode === 'approval') {
      const rejected = await this.waitApproval(run, step, index, tell);
      if (rejected) return step.brief;
    }

    const next = run.steps[index + 1];
    if (next) {
      const at = new Date().toISOString();
      run.updatedAt = at;
      run.events.push({
        id: randomUUID(),
        at,
        kind: 'handoff',
        message: `«${step.title}» передал только цель, решение и текущий шаг.`,
        stepIndex: index,
      });
      tell();
      await sleep(Math.min(delayMs, 400));
      if (this.halted.has(run.id)) {
        this.markHalted(run);
        tell();
        return step.brief;
      }
    } else {
      tell();
    }
    return step.brief;
  }

  private async speak(
    run: Run,
    step: RunStep,
    index: number,
    incoming: HandoffBrief | null,
    answer: string | null,
    developerPasses: number,
  ) {
    if (ROLE_KINDS.has(step.kind)) {
      return roleTurn({
        kind: step.kind,
        name: step.agentName,
        task: run.task,
        stepMode: step.mode,
        brief: incoming,
        answer,
        project: run.project,
        developerShape: run.developerShape,
        developerPasses,
        asked: answer !== null,
      });
    }
    const legacy = await this.simulated.complete(contextFor(run, index));
    return {
      text: legacy.output,
      handoff: {
        goal: run.task.split('\n')[0] ?? run.task,
        decided: step.handoff || 'Без нового решения.',
        now: step.handoff || 'Дальше по процессу.',
      },
      mapAddition: null,
      question: null,
      shape: 'none' as ReturnShape,
      sentBack: false,
      fixedTest: false,
    };
  }

  private finishWork(
    run: Run,
    step: RunStep,
    started: string,
    output: string,
  ): void {
    const finished = new Date().toISOString();
    // Повторный проход (тестировщик вернул задачу) остаётся в журнале отдельной записью.
    // В прогресс он не входит: на экране считают разные шаги, не число записей.
    run.work.push({
      stepId: step.stepId,
      agentId: step.agentId,
      agentName: step.agentName,
      title: step.title,
      output,
      summary: output.slice(0, 180),
      startedAt: started,
      finishedAt: finished,
    });
    run.updatedAt = finished;
  }

  private async waitApproval(
    run: Run,
    step: RunStep,
    index: number,
    tell: () => void,
  ): Promise<boolean> {
    run.status = 'waiting_approval';
    run.events.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      kind: 'approval',
      message: `«${step.title}» ждёт подтверждения владельца.`,
      stepIndex: index,
    });
    tell();
    const approved = await new Promise<boolean>((resolve) => {
      this.gates.set(run.id, resolve);
    });
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return true;
    }
    const decidedAt = new Date().toISOString();
    run.updatedAt = decidedAt;
    if (!approved) {
      run.status = 'failed';
      run.error = 'Владелец отклонил шаг.';
      run.finishedAt = decidedAt;
      run.events.push({
        id: randomUUID(),
        at: decidedAt,
        kind: 'error',
        message: run.error,
        stepIndex: index,
      });
      tell();
      return true;
    }
    run.status = 'running';
    run.events.push({
      id: randomUUID(),
      at: decidedAt,
      kind: 'approval',
      message: `Владелец подтвердил «${step.title}».`,
      stepIndex: index,
    });
    tell();
    return false;
  }

  /** Сборка и сверка после уже принятого плана. Готовые куски второй раз не пишет. */
  private async completeDeep(
    run: Run,
    tell: () => void,
    delayMs: number,
    edited: TaskPlan,
  ): Promise<void> {
    const planStep = run.steps.find((step) => step.mode === 'plan');
    if (
      !planStep ||
      !run.work.some((item) => item.stepId === planStep.stepId)
    ) {
      const planned = await this.showPiece(
        run,
        'plan',
        formatPlan(edited),
        'План записан в папку задачи.',
        tell,
        delayMs,
      );
      if (!planned) return;
    }

    if (!run.buildText) {
      const built = buildFromPlan(edited);
      run.buildText = built;
      const assembled = await this.showPiece(
        run,
        'build',
        built,
        'Сборка идёт по чеклисту.',
        tell,
        delayMs,
      );
      if (!assembled) return;
    }

    if (!run.reviewText) {
      const review = reviewAgainst(edited, run.buildText ?? '');
      run.reviewText = review;
      const reviewed = await this.showPiece(
        run,
        'review',
        review,
        'Сверка идёт по чеклисту.',
        tell,
        delayMs,
      );
      if (!reviewed) return;
    }

    const ended = new Date().toISOString();
    const note = run.note ?? lookNote(run.task, run.project);
    const buildText = run.buildText ?? '';
    const reviewText = run.reviewText ?? '';
    if (!run.archive) {
      run.archive = {
        note,
        plan: edited,
        result: archiveResult(buildText, reviewText),
        at: ended,
        folder: null,
      };
      this.persistArchive(run);
    }
    this.closeMap(run);
    run.status = 'completed';
    run.stepIndex = null;
    run.pendingQuestion = null;
    run.finalResult =
      run.archive?.result ?? archiveResult(buildText, reviewText);
    run.finishedAt = ended;
    run.updatedAt = ended;
    run.events.push({
      id: randomUUID(),
      at: ended,
      kind: 'done',
      message: 'План и результат лежат в архиве задачи.',
      stepIndex: null,
    });
    tell();
  }

  /**
   * Галка включена: заметка, план, сборка по чеклисту, сверка, архив.
   * Режим шага выбирает, кто пишет кусок. Дерево холста не переставляется.
   * Cursor здесь не вызывается.
   */
  private async executeDeep(
    run: Run,
    publish: (run: Run) => void,
    delayMs: number,
    resuming = false,
  ): Promise<void> {
    const tell = () => publish(structuredClone(run));
    try {
      if (!resuming || !run.note) {
        const started = new Date().toISOString();
        run.status = 'running';
        run.updatedAt = started;
        run.events.push({
          id: randomUUID(),
          at: started,
          kind: 'progress',
          message: 'Глубокое мышление: сначала короткая заметка, затем план.',
          stepIndex: null,
        });
        tell();

        const note = lookNote(run.task, run.project);
        run.note = note;
        const noted = await this.showPiece(
          run,
          'ask',
          note,
          'Короткая заметка: что уже есть в проекте.',
          tell,
          delayMs,
        );
        if (!noted) return;
      }

      let edited = resuming ? run.plan : null;
      if (!edited) {
        run.plan = draftPlan(run.task);
        this.persistPieces(run);
        const planIndex = run.steps.findIndex((step) => step.mode === 'plan');
        const waitingAt = new Date().toISOString();
        run.status = 'waiting_plan';
        run.stepIndex = planIndex >= 0 ? planIndex : null;
        run.pendingQuestion = null;
        run.updatedAt = waitingAt;
        run.events.push({
          id: randomUUID(),
          at: waitingAt,
          kind: 'progress',
          message: 'План из четырёх частей можно поправить перед сборкой.',
          stepIndex: run.stepIndex,
        });
        tell();

        edited = await new Promise<TaskPlan>((resolve) => {
          this.plans.set(run.id, resolve);
        });
        if (this.halted.has(run.id)) {
          this.markHalted(run);
          tell();
          return;
        }
        run.plan = edited;
        this.persistPieces(run);
        const acceptedAt = new Date().toISOString();
        run.updatedAt = acceptedAt;
        run.events.push({
          id: randomUUID(),
          at: acceptedAt,
          kind: 'progress',
          message: 'План принят. Сборка берёт его в контекст.',
          stepIndex: planIndex >= 0 ? planIndex : null,
        });
      }
      await this.completeDeep(run, tell, delayMs, edited);
    } catch (error) {
      if (this.halted.has(run.id)) {
        this.markHalted(run);
        tell();
        return;
      }
      const failedAt = new Date().toISOString();
      this.gates.delete(run.id);
      this.answers.delete(run.id);
      this.plans.delete(run.id);
      this.accessGates.delete(run.id);
      run.status = 'failed';
      run.pendingQuestion = null;
      run.pendingAccess = null;
      run.error =
        error instanceof Error ? error.message : 'Шаг завершился ошибкой.';
      run.finishedAt = failedAt;
      run.updatedAt = failedAt;
      run.events.push({
        id: randomUUID(),
        at: failedAt,
        kind: 'error',
        message: run.error,
        stepIndex: run.stepIndex,
      });
      tell();
    }
  }

  /** Пишет один кусок в диалог шага с этим режимом. Соседние реплики в текст не кладёт. */
  private async showPiece(
    run: Run,
    mode: PieceMode,
    text: string,
    event: string,
    tell: () => void,
    delayMs: number,
  ): Promise<boolean> {
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return false;
    }
    const index = run.steps.findIndex((step) => step.mode === mode);
    const step = index >= 0 ? run.steps[index] : undefined;
    const at = new Date().toISOString();
    run.status = 'running';
    run.stepIndex = index >= 0 ? index : null;
    run.updatedAt = at;
    run.events.push({
      id: randomUUID(),
      at,
      kind: 'progress',
      message: step ? `${step.agentName}: ${event}` : event,
      stepIndex: run.stepIndex,
    });
    if (step) {
      say(step, 'role', text);
      const finished = new Date().toISOString();
      // Повтор того же шага не добавляет ещё одну работу: счётчик шагов от этого рос бы выше списка.
      if (!run.work.some((item) => item.stepId === step.stepId)) {
        run.work.push({
          stepId: step.stepId,
          agentId: step.agentId,
          agentName: step.agentName,
          title: step.title,
          output: text,
          summary: text.slice(0, 180),
          startedAt: at,
          finishedAt: finished,
        });
      }
    }
    tell();
    await sleep(delayMs);
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return false;
    }
    return true;
  }

  private arm(run: Run): void {
    this.liveRuns.set(run.id, run);
  }

  /** Доводит сохранённое ожидание и снимает запуск с памяти, когда цикл кончился. */
  private bound(
    run: Run,
    publish: (run: Run) => void,
    body: () => Promise<void>,
  ): void {
    void body()
      .catch((error: unknown) => {
        if (run.status === 'failed' || run.status === 'completed') return;
        if (this.halted.has(run.id)) {
          this.markHalted(run);
        } else {
          const failedAt = new Date().toISOString();
          run.status = 'failed';
          run.error =
            error instanceof Error ? error.message : 'Шаг завершился ошибкой.';
          run.finishedAt = failedAt;
          run.updatedAt = failedAt;
          run.pendingQuestion = null;
          run.pendingAccess = null;
        }
        publish(structuredClone(run));
      })
      .finally(() => this.release(run.id));
  }

  private release(runId: string): void {
    this.liveRuns.delete(runId);
    this.halted.delete(runId);
    this.gates.delete(runId);
    this.answers.delete(runId);
    this.plans.delete(runId);
    this.accessGates.delete(runId);
    this.sessionTrusts.delete(runId);
    this.sessionShells.delete(runId);
  }

  /** Ставит причину обрыва один раз. Повторный вызов не дописывает событие. */
  private markHalted(run: Run): void {
    const reason = this.halted.get(run.id);
    if (!reason) return;
    if (run.status === 'failed' && run.error === reason) return;
    const at = new Date().toISOString();
    run.status = 'failed';
    run.error = reason;
    run.pendingQuestion = null;
    run.pendingAccess = null;
    run.finishedAt = at;
    run.updatedAt = at;
    run.events.push({
      id: randomUUID(),
      at,
      kind: 'error',
      message: reason,
      stepIndex: run.stepIndex,
    });
  }

  /** Будит ожидание вопроса, проверки или плана, чтобы цикл увидел обрыв. */
  private releaseWaiters(runId: string): void {
    const gate = this.gates.get(runId);
    if (gate) {
      this.gates.delete(runId);
      gate(false);
    }
    const answer = this.answers.get(runId);
    if (answer) {
      this.answers.delete(runId);
      answer('');
    }
    const plan = this.plans.get(runId);
    if (plan) {
      this.plans.delete(runId);
      plan({ why: '', changes: '', how: '', checklist: '' });
    }
    const access = this.accessGates.get(runId);
    if (access) {
      this.accessGates.delete(runId);
      access('deny');
    }
  }

  private shellBaseAllowed(
    runId: string,
    base: string,
    folder: string,
    options: RunOptions,
  ): boolean {
    if (this.sessionShells.get(runId)?.has(base)) return true;
    return options.isShellAllowed?.(base, folder) === true;
  }

  /** Останавливает шаг, пока владелец не разрешит конкретную команду. */
  private async allowShell(
    run: Run,
    command: string,
    base: string,
    folder: string,
    index: number,
    tell: () => void,
    options: RunOptions,
  ): Promise<boolean> {
    if (this.shellBaseAllowed(run.id, base, folder, options)) return true;
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return false;
    }
    const askedAt = new Date().toISOString();
    run.status = 'waiting_access';
    run.pendingAccess = {
      kind: 'shell',
      path: base,
      command,
      message: 'Агент хочет выполнить команду в папке проекта. Разрешить её?',
    };
    run.updatedAt = askedAt;
    run.events.push({
      id: randomUUID(),
      at: askedAt,
      kind: 'approval',
      message: `Нужно разрешение на команду: ${command}`,
      stepIndex: index,
    });
    tell();
    const decision = await new Promise<AccessDecision>((resolve) => {
      this.accessGates.set(run.id, resolve);
    });
    run.pendingAccess = null;
    if (this.halted.has(run.id) || decision === 'deny') {
      this.markHalted(run);
      tell();
      return false;
    }
    if (decision === 'always') options.grantShellAlways?.(base, folder);
    if (decision === 'once') {
      const granted = this.sessionShells.get(run.id) ?? new Set<string>();
      granted.add(base);
      this.sessionShells.set(run.id, granted);
    }
    const decidedAt = new Date().toISOString();
    run.status = 'running';
    run.updatedAt = decidedAt;
    run.events.push({
      id: randomUUID(),
      at: decidedAt,
      kind: 'approval',
      message:
        decision === 'always'
          ? `Команда «${base}» разрешена постоянно.`
          : `Команда «${base}» разрешена на этот запуск.`,
      stepIndex: index,
    });
    tell();
    return true;
  }

  /** Останавливает шаг CLI, пока владелец не решит, доверять ли папке. */
  private async allowWorkspace(
    run: Run,
    folder: string,
    index: number,
    tell: () => void,
    options: RunOptions,
  ): Promise<boolean> {
    const path = normalizeAccessPath(folder);
    if (!path) return false;
    const trusted =
      options.isWorkspaceTrusted?.(path) === true ||
      this.sessionTrusts.get(run.id)?.has(path) === true;
    if (trusted) return true;
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return false;
    }
    const askedAt = new Date().toISOString();
    run.status = 'waiting_access';
    run.pendingAccess = {
      kind: 'workspace',
      path,
      command: null,
      message:
        'Cursor Agent может выполнять код и читать файлы в этой папке. Доверяете ей?',
    };
    run.updatedAt = askedAt;
    run.events.push({
      id: randomUUID(),
      at: askedAt,
      kind: 'approval',
      message: `Нужен доступ к папке ${path}.`,
      stepIndex: index,
    });
    tell();
    const decision = await new Promise<AccessDecision>((resolve) => {
      this.accessGates.set(run.id, resolve);
    });
    run.pendingAccess = null;
    if (this.halted.has(run.id) || decision === 'deny') {
      this.markHalted(run);
      tell();
      return false;
    }
    if (decision === 'always') options.grantWorkspaceAlways?.(path);
    if (decision === 'once') {
      const granted = this.sessionTrusts.get(run.id) ?? new Set<string>();
      granted.add(path);
      this.sessionTrusts.set(run.id, granted);
    }
    const decidedAt = new Date().toISOString();
    run.status = 'running';
    run.updatedAt = decidedAt;
    run.events.push({
      id: randomUUID(),
      at: decidedAt,
      kind: 'approval',
      message:
        decision === 'always'
          ? `Папка ${path} разрешена постоянно.`
          : `Папка ${path} разрешена на этот запуск.`,
      stepIndex: index,
    });
    tell();
    return true;
  }

  private persistPieces(run: Run): void {
    if (!run.note || !run.plan) return;
    const dir = taskDirectory(run.project, run.id);
    run.taskFolder = dir;
    if (!dir) return;
    writeTaskPieces(dir, { note: run.note, plan: run.plan });
  }

  private persistArchive(run: Run): void {
    if (!run.archive || !run.note || !run.plan) return;
    const dir = run.taskFolder ?? taskDirectory(run.project, run.id);
    if (!dir) return;
    run.archive.folder = writeTaskArchive(dir, {
      note: run.archive.note,
      plan: run.archive.plan,
      result: run.archive.result,
    });
  }

  /** Карту пишет только оркестратор и только если заметки ролей её меняют. */
  private closeMap(run: Run): void {
    const orchestrator = run.steps.find((step) => step.kind === 'orchestrator');
    const additions = run.steps
      .map((step) => step.mapAddition)
      .filter((item): item is string => Boolean(item && item.trim()));
    if (!orchestrator) {
      run.mapWritten = false;
      run.mapNote = 'Оркестратора в задаче нет, карту никто не пишет.';
      return;
    }
    const project = run.project;
    if (!project) {
      say(orchestrator, 'role', 'Карта не изменилась, файл не переписываю.');
      run.mapWritten = false;
      run.mapNote = 'Карта не изменилась.';
      return;
    }
    const result = writeProjectMap(project, additions);
    run.mapWritten = result.wrote;
    const text = result.wrote
      ? `Карта изменилась, записал её в конце: ${project.mapPath ?? 'файл карты'}.`
      : !project.available && additions.length > 0
        ? 'Роли оставили заметки к карте, но папка проекта не задана, файл не пишу.'
        : 'Карта не изменилась, файл не переписываю.';
    say(orchestrator, 'role', text);
    run.mapNote = text;
    if (result.body && result.wrote) project.mapText = result.body;
  }
}
