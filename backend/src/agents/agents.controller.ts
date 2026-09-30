import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { Agent, AgentKind, Harness } from '../domain';
import { AgentsService } from './agents.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Ожидался JSON-объект.');
  }
  return body as Record<string, unknown>;
}

function kindOf(value: unknown): AgentKind {
  if (
    value === 'planner' ||
    value === 'builder' ||
    value === 'reviewer' ||
    value === 'custom'
  ) {
    return value;
  }
  throw new BadRequestException(
    'Тип агента: planner, builder, reviewer или custom.',
  );
}

function harnessOf(value: unknown): Harness {
  if (value === 'simulated' || value === 'cursor') return value;
  throw new BadRequestException('Среда: simulated или cursor.');
}

function textOf(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string')
    throw new BadRequestException(`Поле ${key} обязательно.`);
  return value;
}

@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list(): Agent[] {
    return this.agents.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Agent {
    return this.agents.get(id);
  }

  @Post()
  create(@Body() body: unknown): Agent {
    const record = asRecord(body);
    return this.agents.create(
      textOf(record, 'name'),
      kindOf(record.kind),
      textOf(record, 'instructions'),
      harnessOf(record.harness),
    );
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown): Agent {
    const record = asRecord(body);
    return this.agents.update(
      id,
      textOf(record, 'name'),
      kindOf(record.kind),
      textOf(record, 'instructions'),
      harnessOf(record.harness),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.agents.remove(id);
    return { ok: true };
  }
}
