/** HTTP доски: задачи, перенос в работу, правка плана и отдача в сборку. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { BoardStatus, BoardTask, WorkMode } from './model';
import { BoardService, type TeamInput } from './board.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Ожидался JSON-объект.');
  }
  return body as Record<string, unknown>;
}

function workMode(value: unknown): WorkMode {
  if (value === 'ask' || value === 'plan' || value === 'agent') return value;
  throw new BadRequestException('Режим: ask, plan или agent.');
}

function teamOf(value: unknown): TeamInput[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Нужна команда: список агентов.');
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new BadRequestException('Участник команды должен быть объектом.');
    }
    const record = item as { agentId?: unknown; mode?: unknown };
    if (typeof record.agentId !== 'string') {
      throw new BadRequestException('У участника нужен agentId.');
    }
    return {
      agentId: record.agentId,
      mode: record.mode === undefined ? undefined : workMode(record.mode),
    };
  });
}

function statusOf(value: unknown): BoardStatus {
  if (
    value === 'new' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'completed'
  ) {
    return value;
  }
  throw new BadRequestException(
    'Статус: new, in_progress, review или completed.',
  );
}

@Controller('board')
export class BoardController {
  constructor(private readonly board: BoardService) {}

  @Get()
  list(): BoardTask[] {
    return this.board.list();
  }

  @Get(':id')
  get(@Param('id') id: string): BoardTask {
    return this.board.get(id);
  }

  @Post()
  create(@Body() body: unknown): BoardTask {
    const record = asRecord(body);
    if (typeof record.title !== 'string') {
      throw new BadRequestException('Нужно название задачи.');
    }
    if (
      record.description !== undefined &&
      typeof record.description !== 'string'
    ) {
      throw new BadRequestException('Описание должно быть строкой.');
    }
    const workflowId = record.workflowId;
    if (
      workflowId !== undefined &&
      workflowId !== null &&
      typeof workflowId !== 'string'
    ) {
      throw new BadRequestException('workflowId должен быть строкой.');
    }
    const projectId = record.projectId;
    if (typeof projectId !== 'string') {
      throw new BadRequestException('Нужен projectId — проект или workspace.');
    }
    const teamRaw = record.team;
    let team: TeamInput[] | undefined;
    if (teamRaw !== undefined) {
      team = teamOf(teamRaw);
    }
    return this.board.create(
      record.title,
      typeof record.description === 'string' ? record.description : '',
      {
        projectId,
        team,
        workflowId:
          typeof workflowId === 'string' && workflowId.trim()
            ? workflowId.trim()
            : undefined,
      },
    );
  }

  @Post(':id/move')
  move(@Param('id') id: string, @Body() body: unknown): BoardTask {
    const record = asRecord(body);
    return this.board.move(id, statusOf(record.status));
  }

  @Put(':id/plan')
  savePlan(@Param('id') id: string, @Body() body: unknown): BoardTask {
    const record = asRecord(body);
    if (typeof record.text !== 'string') {
      throw new BadRequestException('Нужен текст плана.');
    }
    return this.board.updatePlan(id, record.text);
  }

  @Post(':id/build')
  build(@Param('id') id: string, @Body() body: unknown): BoardTask {
    const record = asRecord(body);
    if (record.text !== undefined && typeof record.text !== 'string') {
      throw new BadRequestException('Текст плана должен быть строкой.');
    }
    return this.board.handToBuild(
      id,
      typeof record.text === 'string' ? record.text : undefined,
    );
  }

  @Post(':id/complete')
  complete(@Param('id') id: string): BoardTask {
    return this.board.completeReview(id);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Body() body: unknown): BoardTask {
    const record = asRecord(body);
    if (typeof record.note !== 'string') {
      throw new BadRequestException('Нужна заметка для возврата в работу.');
    }
    return this.board.reopenFromReview(id, record.note);
  }

  @Post(':id/answer')
  answer(@Param('id') id: string, @Body() body: unknown) {
    const record = asRecord(body);
    if (typeof record.text !== 'string') {
      throw new BadRequestException('Нужен текст ответа.');
    }
    return this.board.answerFromReview(id, record.text);
  }
}
