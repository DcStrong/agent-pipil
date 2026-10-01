import { randomUUID } from 'node:crypto';
import type {
  AgentContext,
  AgentKind,
  DialogueAuthor,
  HandoffBrief,
  ReturnShape,
  Run,
  RunStep,
  TaskPlan,
} from '../domain';
import { runCursorCliStep } from './cursor-cli';
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

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    options: {
      delayMs?: number;
      cursorConnected: boolean;
      live: boolean;
      cursorMode: CursorConnectionMode;
      cursorToken: string | null;
      projectFolder: string | null;
      workspaceFile: string | null;
    },
  ): Promise<void> {
    this.liveRuns.set(run.id, run);
    try {
      if (run.deepThinking) {
        await this.executeDeep(run, publish, options.delayMs ?? readDelayMs());
        return;
      }
      await this.executeSteps(run, publish, options);
    } finally {
      this.liveRuns.delete(run.id);
      this.halted.delete(run.id);
      this.gates.delete(run.id);
      this.answers.delete(run.id);
      this.plans.delete(run.id);
    }
  }

  private async executeSteps(
    run: Run,
    publish: (run: Run) => void,
    options: {
      delayMs?: number;
      cursorConnected: boolean;
      live: boolean;
      cursorMode: CursorConnectionMode;
      cursorToken: string | null;
      projectFolder: string | null;
      workspaceFile: string | null;
    },
  ): Promise<void> {
    const delayMs = options.delayMs ?? readDelayMs();
    const tell = () => publish(structuredClone(run));
    let incoming: HandoffBrief | null = null;
    try {
      let index = 0;
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
        );
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
      run.status = 'failed';
      run.pendingQuestion = null;
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
    options: {
      cursorConnected: boolean;
      live: boolean;
      cursorMode: CursorConnectionMode;
      cursorToken: string | null;
      projectFolder: string | null;
      workspaceFile: string | null;
    },
  ): Promise<HandoffBrief | null> {
    if (this.halted.has(run.id)) {
      this.markHalted(run);
      tell();
      return incoming;
    }
    const step = run.steps[index];
    const started = new Date().toISOString();
    run.status = 'running';
    run.stepIndex = index;
    run.pendingQuestion = null;
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
            ? `${step.agentName} не может вызвать Cursor: CLI «agent» не найден на сервере.`
            : `${step.agentName} не может вызвать Cursor: живой режим выключен (CURSOR_LIVE=0).`
      : `${step.agentName} открыл новый диалог «${step.title}».`;
    run.events.push({
      id: randomUUID(),
      at: started,
      kind: 'progress',
      message: note,
      stepIndex: index,
    });
    if (incoming) say(step, 'handoff', briefLine(incoming));
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
        if (!options.cursorConnected) {
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
      const stepInput = {
        token: options.cursorToken ?? '',
        task: run.task,
        stepTitle: step.title,
        agentName: step.agentName,
        instructions: step.instructions,
        skills: step.skills,
        projectFolder: options.projectFolder,
        workspaceFile: options.workspaceFile,
      };
      const cursorResult =
        options.cursorMode === 'cli'
          ? await runCursorCliStep(stepInput)
          : await this.cursor.runStep(stepInput);
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

  /**
   * Галка включена: заметка, план, сборка по чеклисту, сверка, архив.
   * Режим шага выбирает, кто пишет кусок. Дерево холста не переставляется.
   * Cursor здесь не вызывается.
   */
  private async executeDeep(
    run: Run,
    publish: (run: Run) => void,
    delayMs: number,
  ): Promise<void> {
    const tell = () => publish(structuredClone(run));
    try {
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

      const edited = await new Promise<TaskPlan>((resolve) => {
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
      const planned = await this.showPiece(
        run,
        'plan',
        formatPlan(edited),
        'План записан в папку задачи.',
        tell,
        delayMs,
      );
      if (!planned) return;

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

      const review = reviewAgainst(edited, built);
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

      const ended = new Date().toISOString();
      run.archive = {
        note,
        plan: edited,
        result: archiveResult(built, review),
        at: ended,
        folder: null,
      };
      this.persistArchive(run);
      this.closeMap(run);
      run.status = 'completed';
      run.stepIndex = null;
      run.pendingQuestion = null;
      run.finalResult = run.archive.result;
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
      run.status = 'failed';
      run.pendingQuestion = null;
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

  /** Ставит причину обрыва один раз. Повторный вызов не дописывает событие. */
  private markHalted(run: Run): void {
    const reason = this.halted.get(run.id);
    if (!reason) return;
    if (run.status === 'failed' && run.error === reason) return;
    const at = new Date().toISOString();
    run.status = 'failed';
    run.error = reason;
    run.pendingQuestion = null;
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
