import { randomUUID } from 'node:crypto';
import type { AgentContext, Run } from '../domain';
import type { AgentRuntime } from '../agents/agent-runtime';

export function readDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SIM_DELAY_MS;
  if (raw === undefined || raw.trim() === '') return 1400;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 1400;
  return Math.min(value, 10_000);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function contextFor(run: Run, index: number): AgentContext {
  const stage = run.stages[index];
  const previous = index > 0 ? run.stages[index - 1] : undefined;
  return {
    roleName: stage.roleName,
    systemPrompt: stage.systemPrompt,
    skills: stage.skills,
    task: run.task,
    priorWork: run.work.map((item) => ({
      roleName: item.roleName,
      output: item.output,
    })),
    incomingHandoff: previous ? previous.handoffInstruction : null,
    outgoingHandoff: stage.handoffInstruction,
    isFinalStage: index === run.stages.length - 1,
  };
}

/**
 * Walks one task through the snapshotted stages and publishes after each change.
 */
export class PipelineRunner {
  constructor(private readonly runtime: AgentRuntime) {}

  async execute(
    run: Run,
    publish: (run: Run) => void,
    delayMs = readDelayMs(),
  ): Promise<void> {
    const tell = () => publish(structuredClone(run));
    try {
      for (let index = 0; index < run.stages.length; index += 1) {
        const stage = run.stages[index];
        const started = new Date().toISOString();
        run.stageIndex = index;
        run.ownerRoleId = stage.roleId;
        run.ownerName = stage.roleName;
        run.updatedAt = started;
        run.events.push({
          id: randomUUID(),
          at: started,
          kind: 'stage_started',
          message: `${stage.roleName} owns the task.`,
          stageIndex: index,
          roleId: stage.roleId,
        });
        tell();
        await sleep(delayMs);

        const turn = await this.runtime.complete(contextFor(run, index));
        const finished = new Date().toISOString();
        run.work.push({
          stageId: stage.stageId,
          roleId: stage.roleId,
          roleName: stage.roleName,
          output: turn.output,
          summary: turn.summary,
          startedAt: started,
          finishedAt: finished,
        });
        run.updatedAt = finished;
        if (index < run.stages.length - 1) {
          const next = run.stages[index + 1];
          run.events.push({
            id: randomUUID(),
            at: finished,
            kind: 'handoff',
            message: `${stage.roleName} handed the task to ${next.roleName}.`,
            stageIndex: index,
            roleId: stage.roleId,
          });
          tell();
          await sleep(Math.min(delayMs, 450));
        }
      }

      const last = run.work[run.work.length - 1];
      const ended = new Date().toISOString();
      run.status = 'completed';
      run.stageIndex = null;
      run.ownerRoleId = null;
      run.ownerName = null;
      run.finalResult = last?.output ?? '';
      run.updatedAt = ended;
      run.events.push({
        id: randomUUID(),
        at: ended,
        kind: 'completed',
        message: 'The run finished.',
        stageIndex: null,
        roleId: null,
      });
      tell();
    } catch (error) {
      const failedAt = new Date().toISOString();
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : 'The agent failed.';
      run.updatedAt = failedAt;
      run.events.push({
        id: randomUUID(),
        at: failedAt,
        kind: 'failed',
        message: run.error,
        stageIndex: run.stageIndex,
        roleId: run.ownerRoleId,
      });
      tell();
    }
  }
}
