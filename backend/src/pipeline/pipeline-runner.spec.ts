import type { AgentContext, AgentTurn, Run } from '../domain';
import type { AgentRuntime } from '../agents/agent-runtime';
import { PipelineRunner } from './pipeline-runner';

function sampleRun(): Run {
  const stage = (
    roleName: string,
    handoff: string,
    skillName: string,
  ): Run['stages'][number] => ({
    stageId: `stage_${roleName}`,
    roleId: `role_${roleName}`,
    roleName,
    systemPrompt: `You are the ${roleName}.`,
    handoffInstruction: handoff,
    skills: [
      {
        name: 'Stay in scope',
        instructions: 'Only the task.',
        scope: 'shared',
      },
      { name: skillName, instructions: 'Role note.', scope: 'role' },
    ],
  });

  return {
    id: 'run_1',
    task: 'Add a password reset flow',
    status: 'running',
    stageIndex: null,
    ownerRoleId: null,
    ownerName: null,
    stages: [
      stage('Analyst', 'Pass the problem.', 'Separate facts'),
      stage('Architect', 'Pass the approach.', 'Smallest design'),
      stage('Developer', 'Pass the changes.', 'Name the changes'),
      stage('Reviewer', '', 'Give a verdict'),
    ],
    work: [],
    events: [],
    finalResult: null,
    error: null,
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
  };
}

describe('PipelineRunner', () => {
  it('walks the task from role to role and keeps the last output as the result', async () => {
    const seen: AgentContext[] = [];
    const owners: Array<string | null> = [];
    const runtime: AgentRuntime = {
      mode: 'simulated',
      complete: (context) => {
        seen.push(context);
        const turn: AgentTurn = {
          output: `OUT:${context.roleName}`,
          summary: `SUM:${context.roleName}`,
        };
        return Promise.resolve(turn);
      },
    };

    const run = sampleRun();
    await new PipelineRunner(runtime).execute(
      run,
      (snapshot) => {
        owners.push(snapshot.ownerName);
      },
      0,
    );

    expect(seen.map((item) => item.roleName)).toEqual([
      'Analyst',
      'Architect',
      'Developer',
      'Reviewer',
    ]);
    expect(seen[1]?.incomingHandoff).toBe('Pass the problem.');
    expect(seen[1]?.priorWork).toEqual([
      { roleName: 'Analyst', output: 'OUT:Analyst' },
    ]);
    expect(seen[0]?.skills.map((skill) => skill.name)).toEqual([
      'Stay in scope',
      'Separate facts',
    ]);
    expect(seen[3]?.isFinalStage).toBe(true);
    expect(owners).toContain('Analyst');
    expect(owners).toContain('Reviewer');
    expect(owners[owners.length - 1]).toBeNull();
    expect(run.status).toBe('completed');
    expect(run.finalResult).toBe('OUT:Reviewer');
    expect(run.work.map((item) => item.roleName)).toEqual([
      'Analyst',
      'Architect',
      'Developer',
      'Reviewer',
    ]);
    expect(run.events.map((event) => event.kind)).toEqual([
      'stage_started',
      'handoff',
      'stage_started',
      'handoff',
      'stage_started',
      'handoff',
      'stage_started',
      'completed',
    ]);
  });

  it('stops on the role that failed and keeps the earlier work', async () => {
    let calls = 0;
    const runtime: AgentRuntime = {
      mode: 'simulated',
      complete: () => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('model unavailable'));
        return Promise.resolve({ output: 'kept', summary: 'kept' });
      },
    };
    const run = sampleRun();
    await new PipelineRunner(runtime).execute(run, () => undefined, 0);

    expect(run.status).toBe('failed');
    expect(run.error).toBe('model unavailable');
    expect(run.ownerName).toBe('Architect');
    expect(run.stageIndex).toBe(1);
    expect(run.finalResult).toBeNull();
    expect(run.work).toHaveLength(1);
  });
});
