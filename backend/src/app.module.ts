import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module';
import { AppController } from './app.controller';
import { PipelineModule } from './pipeline/pipeline.module';
import { RolesModule } from './roles/roles.module';
import { RunsModule } from './runs/runs.module';
import { SkillsModule } from './skills/skills.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    StoreModule,
    AgentsModule,
    RolesModule,
    SkillsModule,
    PipelineModule,
    RunsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
