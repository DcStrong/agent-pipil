import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Run, type RunStep } from '../domain';
import { StoreService } from './store.service';

function step(): RunStep {
  return {
    stepId: 'step-1',
    agentId: 'agent-1',
    agentName: 'Сборщик',
    title: 'Сборка',
    mode: 'automatic',
    handoff: 'дальше',
    instructions: 'делай',
    harness: 'simulated',
    skills: [],
    dialogueId: 'dialogue-1',
    kind: 'developer',
    messages: [],
    brief: null,
    question: null,
    mapAddition: null,
    cliSessionId: null,
  };
}

function run(id: string, status: Run['status'], extra: Partial<Run> = {}): Run {
  const now = '2026-10-05T00:00:00.000Z';
  return {
    id,
    workflowId: 'workflow',
    workflowName: 'Процесс',
    task: 'Задача',
    status,
    stepIndex: 0,
    steps: [step()],
    work: [],
    events: [],
    finalResult: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    project: null,
    developerShape: 'none',
    pendingQuestion: null,
    pendingAccess: null,
    mapWritten: false,
    mapNote: null,
    deepThinking: false,
    note: null,
    plan: null,
    buildText: null,
    reviewText: null,
    taskFolder: null,
    archive: null,
    ...extra,
  };
}

describe('StoreService — перезапуск', () => {
  let directory = '';

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('running становится interrupted, ожидание доступа остаётся', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipil-store-'));
    const path = join(directory, 'state.json');
    const first = new StoreService(path);
    first.upsertRun(run('live', 'running'));
    first.upsertRun(
      run('access', 'waiting_access', {
        pendingAccess: {
          kind: 'workspace',
          path: '/tmp/project',
          message: 'Доверяете папке?',
          command: null,
        },
      }),
    );
    await first.whenSaved();

    const restarted = new StoreService(path);
    const live = restarted.getRun('live');
    const access = restarted.getRun('access');
    expect(live?.status).toBe('interrupted');
    expect(live?.finishedAt).toBeNull();
    expect(live?.error).toContain('Сборка');
    expect(live?.error).toContain('продолжить');
    expect(
      live?.steps[0]?.messages.some((item) => item.text === live.error),
    ).toBe(true);
    expect(access?.status).toBe('waiting_access');
    expect(access?.pendingAccess?.path).toBe('/tmp/project');
    expect(access?.error).toBeNull();
  });
});
