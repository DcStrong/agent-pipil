import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module';
import { AppController } from './app.controller';
import { BoardModule } from './board/board.module';
import { PresetsModule } from './presets/presets.module';
import { ProjectsModule } from './projects/projects.module';
import { ProjectCursorModule } from './project/project-cursor.module';
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
    PresetsModule,
    SettingsModule,
    ProjectCursorModule,
    ProjectsModule,
    RunsModule,
    BoardModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
