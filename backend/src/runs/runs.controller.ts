import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Run } from '../domain';
import { RunsService } from './runs.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  list(): Run[] {
    return this.runs.list();
  }

  @Get('events')
  events(@Res() res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const subscription = this.runs.watch().subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    });
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    });
  }

  @Get(':id')
  get(@Param('id') id: string): Run {
    return this.runs.get(id);
  }

  @Post()
  start(@Body() body: unknown): Run {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const record = body as { workflowId?: unknown; task?: unknown };
    if (typeof record.workflowId !== 'string') {
      throw new BadRequestException('Нужен workflowId.');
    }
    if (typeof record.task !== 'string')
      throw new BadRequestException('Нужна задача.');
    return this.runs.start(record.workflowId, record.task);
  }

  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() body: unknown): Run {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const decision = (body as { decision?: unknown }).decision;
    if (decision !== 'approve' && decision !== 'reject') {
      throw new BadRequestException('Решение: approve или reject.');
    }
    return this.runs.decide(id, decision === 'approve');
  }
}
