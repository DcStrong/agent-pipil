import type { AgentContext } from '../domain';
import { SimulatedAgent } from './simulated-agent';

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    roleName: 'Analyst',
    systemPrompt: 'You are the analyst.',
    skills: [
      {
        name: 'Stay in scope',
        instructions: 'Only the task.',
        scope: 'shared',
      },
    ],
    task: 'Add a password reset flow',
    priorWork: [],
    incomingHandoff: null,
    outgoingHandoff: 'Pass the problem forward.',
    isFinalStage: false,
    ...overrides,
  };
}

describe('SimulatedAgent', () => {
  const agent = new SimulatedAgent();

  it('writes the task and the shared skill into the analysis', async () => {
    const turn = await agent.complete(context());
    expect(turn.output).toContain('Add a password reset flow');
    expect(turn.output).toContain('Stay in scope');
    expect(turn.summary).toContain('Add a password reset flow');
  });

  it('quotes the previous role when the architect takes the handoff', async () => {
    const turn = await agent.complete(
      context({
        roleName: 'Architect',
        priorWork: [
          { roleName: 'Analyst', output: 'Success criteria are listed.' },
        ],
        incomingHandoff: 'Pass the problem forward.',
      }),
    );
    expect(turn.output).toContain('Received from Analyst');
    expect(turn.output).toContain('Success criteria are listed.');
  });

  it('closes a review with a final result', async () => {
    const turn = await agent.complete(
      context({
        roleName: 'Reviewer',
        isFinalStage: true,
        incomingHandoff: 'Pass the changes.',
      }),
    );
    expect(turn.output).toContain('## Final result');
    expect(turn.output).toContain('Done: Add a password reset flow.');
    expect(turn.summary).toContain('Approve with notes');
  });
});
