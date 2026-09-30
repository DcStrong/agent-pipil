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
import type { Workflow } from '../domain';
import { WorkflowsService, type StepInput } from './workflows.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Ожидался JSON-объект.');
  }
  return body as Record<string, unknown>;
}

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  list(): Workflow[] {
    return this.workflows.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Workflow {
    return this.workflows.get(id);
  }

  @Post()
  create(@Body() body: unknown): Workflow {
    const record = asRecord(body);
    if (typeof record.name !== 'string')
      throw new BadRequestException('Нужно имя процесса.');
    return this.workflows.create(record.name);
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body() body: unknown): Workflow {
    const record = asRecord(body);
    if (typeof record.name !== 'string')
      throw new BadRequestException('Нужно имя процесса.');
    if (typeof record.description !== 'string') {
      throw new BadRequestException('Нужно описание процесса.');
    }
    if (!Array.isArray(record.steps))
      throw new BadRequestException('steps должен быть списком.');
    return this.workflows.replace(
      id,
      record.name,
      record.description,
      record.steps as StepInput[],
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.workflows.remove(id);
    return { ok: true };
  }
}
