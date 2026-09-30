/** Выбор и сохранение пресетов. Живой API Cursor отсюда не вызывается. */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import type { PipelinePreset, Workflow, WorkflowStep } from '../domain';
import { PresetsService, type PresetStepInput } from './presets.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Ожидался JSON-объект.');
  }
  return body as Record<string, unknown>;
}

@Controller('presets')
export class PresetsController {
  constructor(private readonly presets: PresetsService) {}

  @Get()
  list(): PipelinePreset[] {
    return this.presets.list();
  }

  @Get(':id/steps')
  steps(@Param('id') id: string): {
    name: string;
    description: string;
    steps: WorkflowStep[];
  } {
    return this.presets.stepsFor(id);
  }

  @Post()
  save(@Body() body: unknown): PipelinePreset {
    const record = asRecord(body);
    if (typeof record.name !== 'string') {
      throw new BadRequestException('Нужно имя пресета.');
    }
    if (
      record.description !== undefined &&
      typeof record.description !== 'string'
    ) {
      throw new BadRequestException('Описание пресета должно быть строкой.');
    }
    if (!Array.isArray(record.steps)) {
      throw new BadRequestException('steps должен быть списком.');
    }
    return this.presets.save(
      record.name,
      typeof record.description === 'string' ? record.description : '',
      record.steps as PresetStepInput[],
    );
  }

  @Post(':id/workflows')
  open(@Param('id') id: string): Workflow {
    return this.presets.open(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.presets.remove(id);
    return { ok: true };
  }
}
