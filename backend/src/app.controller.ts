import { Controller, Get, Inject } from '@nestjs/common';
import { AGENT_RUNTIME, type AgentRuntime } from './agents/agent-runtime';

@Controller()
export class AppController {
  constructor(@Inject(AGENT_RUNTIME) private readonly runtime: AgentRuntime) {}

  @Get('health')
  health(): { ok: true; agentMode: 'simulated' | 'model' } {
    return { ok: true, agentMode: this.runtime.mode };
  }
}
