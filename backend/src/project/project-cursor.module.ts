/** Раздел проекта. Не зависит от токена и клиента Cursor. */
import { Module } from '@nestjs/common';
import { ProjectCursorController } from './project-cursor.controller';
import { ProjectCursorService } from './project-cursor.service';

@Module({
  controllers: [ProjectCursorController],
  providers: [ProjectCursorService],
})
export class ProjectCursorModule {}
