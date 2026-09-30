import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [SettingsModule],
  controllers: [RunsController],
  providers: [RunsService],
})
export class RunsModule {}
