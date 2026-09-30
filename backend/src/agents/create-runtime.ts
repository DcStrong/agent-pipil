import { ModelAgent } from './model-agent';
import { SimulatedAgent } from './simulated-agent';
import type { AgentRuntime } from './agent-runtime';

export function createRuntime(env: NodeJS.ProcessEnv): AgentRuntime {
  const mode = env.AGENT_MODE?.trim();
  const key = env.MODEL_API_KEY?.trim();
  if (mode === 'simulated') return new SimulatedAgent();
  if (mode === 'model' || key) {
    if (!key) {
      throw new Error('AGENT_MODE=model requires MODEL_API_KEY.');
    }
    return new ModelAgent({
      apiKey: key,
      baseUrl: env.MODEL_BASE_URL?.trim() || 'https://api.openai.com/v1',
      model: env.MODEL_NAME?.trim() || 'gpt-4o-mini',
    });
  }
  return new SimulatedAgent();
}
