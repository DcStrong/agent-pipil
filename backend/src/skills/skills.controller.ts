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
import type { Skill, SkillScope } from '../domain';
import { SkillsService } from './skills.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Ожидался JSON-объект.');
  }
  return body as Record<string, unknown>;
}

@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list(): Skill[] {
    return this.skills.list();
  }

  @Post()
  create(@Body() body: unknown): Skill {
    const parsed = this.parse(asRecord(body));
    return this.skills.create(
      parsed.name,
      parsed.instructions,
      parsed.scope,
      parsed.agentId,
    );
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown): Skill {
    const parsed = this.parse(asRecord(body));
    return this.skills.update(
      id,
      parsed.name,
      parsed.instructions,
      parsed.scope,
      parsed.agentId,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.skills.remove(id);
    return { ok: true };
  }

  private parse(body: Record<string, unknown>): {
    name: string;
    instructions: string;
    scope: SkillScope;
    agentId: string | null;
  } {
    if (typeof body.name !== 'string')
      throw new BadRequestException('Нужно имя навыка.');
    if (typeof body.instructions !== 'string') {
      throw new BadRequestException('Нужны инструкции навыка.');
    }
    if (body.scope !== 'shared' && body.scope !== 'agent') {
      throw new BadRequestException('Область навыка: shared или agent.');
    }
    const agentId = body.agentId;
    if (
      agentId !== undefined &&
      agentId !== null &&
      typeof agentId !== 'string'
    ) {
      throw new BadRequestException('agentId должен быть строкой или null.');
    }
    return {
      name: body.name,
      instructions: body.instructions,
      scope: body.scope,
      agentId: typeof agentId === 'string' ? agentId : null,
    };
  }
}
