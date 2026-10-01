import { hasCycle, orderSteps } from './step-graph';
import type { WorkflowStep } from '../domain';

function step(id: string, nextIds: string[], agentId = id): WorkflowStep {
  return {
    id,
    agentId,
    title: id,
    mode: 'automatic',
    handoff: 'дальше',
    nextIds,
  };
}

describe('дерево шагов', () => {
  it('без связей идёт по списку', () => {
    const steps = [step('a', []), step('b', []), step('c', [])];
    expect(orderSteps(steps).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('повторяет роль и обходит ветку следом за цепочкой', () => {
    const steps = [
      step('orch', ['an1'], 'analyst'),
      step('an1', ['arch'], 'analyst'),
      step('arch', ['an2'], 'architect'),
      step('an2', ['dev'], 'analyst'),
      step('dev', ['rev'], 'developer'),
      step('rev', [], 'reviewer'),
      step('side', [], 'custom'),
    ];
    steps[0] = step('orch', ['an1', 'side'], 'orchestrator');
    expect(orderSteps(steps).map((item) => item.id)).toEqual([
      'orch',
      'an1',
      'arch',
      'an2',
      'dev',
      'rev',
      'side',
    ]);
    expect(orderSteps(steps).filter((item) => item.agentId === 'analyst')).toHaveLength(2);
  });

  it('замечает петлю', () => {
    expect(hasCycle([step('a', ['b']), step('b', ['a'])])).toBe(true);
    expect(hasCycle([step('a', ['b']), step('b', [])])).toBe(false);
  });
});
