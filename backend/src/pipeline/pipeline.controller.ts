import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
} from '@nestjs/common';
import type { PipelineStage } from '../domain';
import { PipelineService, type StageInput } from './pipeline.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get()
  get(): PipelineStage[] {
    return this.pipeline.get();
  }

  @Put()
  replace(@Body() body: unknown): PipelineStage[] {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Expected a JSON object.');
    }
    const stages = (body as { stages?: unknown }).stages;
    if (!Array.isArray(stages)) {
      throw new BadRequestException('stages must be a list.');
    }
    return this.pipeline.replace(stages as StageInput[]);
  }
}
