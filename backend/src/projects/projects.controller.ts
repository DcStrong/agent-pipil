import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { SavedProjectKind } from '../domain';
import { ProjectsService, type SavedProjectView } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(): SavedProjectView[] {
    return this.projects.list();
  }

  @Post()
  add(@Body() body: unknown): SavedProjectView {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const record = body as { kind?: unknown; path?: unknown };
    if (record.kind !== 'folder' && record.kind !== 'workspace') {
      throw new BadRequestException('kind: folder или workspace.');
    }
    if (typeof record.path !== 'string' || !record.path.trim()) {
      throw new BadRequestException('Нужен путь к папке или файлу workspace.');
    }
    return this.projects.add(record.kind as SavedProjectKind, record.path);
  }

  @Patch(':id')
  updateAlias(
    @Param('id') id: string,
    @Body() body: unknown,
  ): SavedProjectView {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const alias = (body as { alias?: unknown }).alias;
    if (typeof alias !== 'string') {
      throw new BadRequestException('Нужен алиас (можно пустой).');
    }
    return this.projects.updateAlias(id, alias);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: true } {
    return this.projects.remove(id);
  }
}
