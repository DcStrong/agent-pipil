import type { AgentContext, AgentTurn } from '../domain';

export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');

/**
 * One turn for a single role. The pipeline runner calls this once per stage.
 * SimulatedAgent is the default. ModelAgent is used only when a key is set.
 */
export interface AgentRuntime {
  readonly mode: 'simulated' | 'model';
  complete(context: AgentContext): Promise<AgentTurn>;
}
