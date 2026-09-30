import { Module } from '@nestjs/common';
import { AGENT_RUNTIME, type AgentRuntime } from '../agents/agent-runtime';
import { AgentsModule } from '../agents/agents.module';
import { PipelineRunner } from '../pipeline/pipeline-runner';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [AgentsModule],
  controllers: [RunsController],
  providers: [
    RunsService,
    {
      provide: PipelineRunner,
      useFactory: (runtime: AgentRuntime) => new PipelineRunner(runtime),
      inject: [AGENT_RUNTIME],
    },
  ],
})
export class RunsModule {}
