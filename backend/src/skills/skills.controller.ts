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
    throw new BadRequestException('Expected a JSON object.');
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
    const record = asRecord(body);
    const parsed = this.parse(record);
    return this.skills.create(
      parsed.name,
      parsed.instructions,
      parsed.scope,
      parsed.roleId,
    );
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown): Skill {
    const record = asRecord(body);
    const parsed = this.parse(record);
    return this.skills.update(
      id,
      parsed.name,
      parsed.instructions,
      parsed.scope,
      parsed.roleId,
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
    roleId: string | null;
  } {
    if (typeof body.name !== 'string') {
      throw new BadRequestException('name is required.');
    }
    if (typeof body.instructions !== 'string') {
      throw new BadRequestException('instructions is required.');
    }
    if (body.scope !== 'shared' && body.scope !== 'role') {
      throw new BadRequestException('scope must be shared or role.');
    }
    const roleId = body.roleId;
    if (roleId !== undefined && roleId !== null && typeof roleId !== 'string') {
      throw new BadRequestException('roleId must be a string or null.');
    }
    return {
      name: body.name,
      instructions: body.instructions,
      scope: body.scope,
      roleId: typeof roleId === 'string' ? roleId : null,
    };
  }
}
