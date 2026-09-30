import { Module } from '@nestjs/common';
import { AGENT_RUNTIME } from './agent-runtime';
import { createRuntime } from './create-runtime';

@Module({
  providers: [
    {
      provide: AGENT_RUNTIME,
      useFactory: () => createRuntime(process.env),
    },
  ],
  exports: [AGENT_RUNTIME],
})
export class AgentsModule {}
