import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RunsModule } from '../runs/runs.module';
import { BoardController } from './board.controller';
import { BoardService } from './board.service';

@Module({
  imports: [RunsModule, ProjectsModule],
  controllers: [BoardController],
  providers: [BoardService],
})
export class BoardModule {}
