import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { SettingsModule } from '../settings/settings.module';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [SettingsModule, ProjectsModule],
  controllers: [RunsController],
  providers: [RunsService],
})
export class RunsModule {}
