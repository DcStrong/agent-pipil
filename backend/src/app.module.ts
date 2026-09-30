import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module';
import { AppController } from './app.controller';
import { RunsModule } from './runs/runs.module';
import { SettingsModule } from './settings/settings.module';
import { SkillsModule } from './skills/skills.module';
import { StoreModule } from './store/store.module';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [
    StoreModule,
    AgentsModule,
    SkillsModule,
    WorkflowsModule,
    SettingsModule,
    RunsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
