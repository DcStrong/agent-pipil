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
import type { Role } from '../domain';
import { RolesService } from './roles.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Expected a JSON object.');
  }
  return body as Record<string, unknown>;
}

function requiredText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new BadRequestException(`${key} is required.`);
  }
  return value;
}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(): Role[] {
    return this.roles.list();
  }

  @Post()
  create(@Body() body: unknown): Role {
    const record = asRecord(body);
    return this.roles.create(
      requiredText(record, 'name'),
      requiredText(record, 'systemPrompt'),
    );
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown): Role {
    const record = asRecord(body);
    return this.roles.update(
      id,
      requiredText(record, 'name'),
      requiredText(record, 'systemPrompt'),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    this.roles.remove(id);
    return { ok: true };
  }
}
