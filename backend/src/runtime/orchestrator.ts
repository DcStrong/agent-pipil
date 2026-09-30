import { randomUUID } from 'node:crypto';
import type { AgentContext, Run } from '../domain';
import { CursorClient } from './cursor-client';
import { SimulatedAgent } from './simulated-agent';

export function readDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SIM_DELAY_MS;
  if (raw === undefined || raw.trim() === '') return 1100;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 1100;
  return Math.min(value, 10_000);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
  };
}

/**
 * Ведёт одну задачу по шагам.
 * Автоматический шаг сразу передаёт работу дальше.
 * Шаг с подтверждением останавливает запуск, пока владелец не решит.
 */
export class Orchestrator {
  private readonly gates = new Map<string, (approved: boolean) => void>();
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

  async execute(
    run: Run,
    publish: (run: Run) => void,
    options: { delayMs?: number; cursorConnected: boolean; live: boolean },
  ): Promise<void> {
    const delayMs = options.delayMs ?? readDelayMs();
    const tell = () => publish(structuredClone(run));
    try {
      for (let index = 0; index < run.steps.length; index += 1) {
        const step = run.steps[index];
        const started = new Date().toISOString();
        run.status = 'running';
        run.stepIndex = index;
        run.updatedAt = started;
        const viaCursor = step.harness === 'cursor';
        const note = viaCursor
          ? options.cursorConnected
            ? `${step.agentName} ведёт «${step.title}». Токен Cursor сохранён, шаг идёт имитацией.`
            : `${step.agentName} ведёт «${step.title}». Cursor не подключён, шаг идёт имитацией.`
          : `${step.agentName} ведёт «${step.title}».`;
        run.events.push({
          id: randomUUID(),
          at: started,
          kind: 'progress',
          message: note,
          stepIndex: index,
        });
        tell();
        await sleep(delayMs);

        // Живой клиент Cursor не вызывается, пока владелец сам не включит CURSOR_LIVE.
        // Даже тогда клиент отказывается от сети, чтобы не тратить аккаунт.
        if (viaCursor && options.live && this.cursor.liveEnabled()) {
          await this.cursor.runStep();
        }
        const turn = await this.simulated.complete(contextFor(run, index));
        const finished = new Date().toISOString();
        run.work.push({
          stepId: step.stepId,
          agentId: step.agentId,
          agentName: step.agentName,
          title: step.title,
          output: turn.output,
          summary: turn.summary,
          startedAt: started,
          finishedAt: finished,
        });
        run.updatedAt = finished;

        if (step.mode === 'approval') {
          run.status = 'waiting_approval';
          run.events.push({
            id: randomUUID(),
            at: finished,
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
        }

        if (index < run.steps.length - 1) {
          const next = run.steps[index + 1];
          run.events.push({
            id: randomUUID(),
            at: run.updatedAt,
            kind: 'handoff',
            message: `«${step.title}» передал задачу шагу «${next.title}».`,
            stepIndex: index,
          });
          tell();
          await sleep(Math.min(delayMs, 400));
        }
      }

      const last = run.work[run.work.length - 1];
      const ended = new Date().toISOString();
      run.status = 'completed';
      run.stepIndex = null;
      run.finalResult = last?.output ?? '';
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
      run.status = 'failed';
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
}
