import { randomUUID } from 'node:crypto';
import type {
  AgentContext,
  AgentKind,
  DialogueAuthor,
  HandoffBrief,
  ReturnShape,
  Run,
  RunStep,
} from '../domain';
import { CursorClient, hasLocalCursorSession } from './cursor-client';
import { writeProjectMap } from './project-folder';
import { briefLine, roleTurn } from './role-turn';
import { SimulatedAgent } from './simulated-agent';

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
  private readonly simulated = new SimulatedAgent();
  private readonly cursor = new CursorClient();

  constructor() {}

  /** Разрешает или отклоняет текущую точку проверки. */
  decide(runId: string, approved: boolean): boolean {
    const resolve = this.gates.get(runId);
    if (!resolve) return false;
    this.gates.delete(runId);
    resolve(approved);
    return true;
  }

  /** Кладёт ответ владельца в диалог роли, которая спросила. */
  answer(runId: string, text: string): boolean {
    const resolve = this.answers.get(runId);
    if (!resolve) return false;
    this.answers.delete(runId);
    resolve(text);
    return true;
  }

  async execute(
    run: Run,
    publish: (run: Run) => void,
    options: { delayMs?: number; cursorConnected: boolean; live: boolean },
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
        incoming = await this.runStep(run, index, incoming, tell, delayMs, options);
        if (run.status === 'failed') return;
        const sendBack = step.kind === 'tester' && step.brief?.now.startsWith('Разработчику вернуть');
        if (sendBack) {
          const developer = run.steps.findIndex((item) => item.kind === 'developer');
          const passes = run.work.filter((item) => item.stepId === run.steps[developer]?.stepId).length;
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
      const failedAt = new Date().toISOString();
      this.gates.delete(run.id);
      this.answers.delete(run.id);
      run.status = 'failed';
      run.pendingQuestion = null;
      run.error = error instanceof Error ? error.message : 'Шаг завершился ошибкой.';
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
    options: { cursorConnected: boolean; live: boolean },
  ): Promise<HandoffBrief | null> {
    const step = run.steps[index];
    const started = new Date().toISOString();
    run.status = 'running';
    run.stepIndex = index;
    run.pendingQuestion = null;
    run.updatedAt = started;
    const localSession = hasLocalCursorSession();
    const viaCursor = step.harness === 'cursor';
    const sessionNote = localSession
      ? ' Локальная сессия Cursor уже есть, сеть всё равно не вызывается.'
      : '';
    const note = viaCursor
      ? options.cursorConnected
        ? `${step.agentName} ведёт «${step.title}». Токен сохранён, диалог идёт имитацией.${sessionNote}`
        : `${step.agentName} ведёт «${step.title}». Cursor не подключён, диалог идёт имитацией.${sessionNote}`
      : `${step.agentName} открыл новый диалог «${step.title}».${sessionNote}`;
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

    if (viaCursor && options.live && this.cursor.liveEnabled()) {
      await this.cursor.runStep();
    }

    const passes = run.work.filter((item) => item.stepId === step.stepId).length;
    const first = await this.speak(run, step, index, incoming, null, passes);
    say(step, 'role', first.text);
    step.mapAddition = first.mapAddition;
    if (first.shape !== 'none') run.developerShape = first.shape;

    if (step.mode === 'question' && first.question && step.kind !== 'orchestrator') {
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
      const second = await this.speak(run, step, index, incoming, answer.trim(), passes);
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

  private finishWork(run: Run, step: RunStep, started: string, output: string): void {
    const finished = new Date().toISOString();
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
