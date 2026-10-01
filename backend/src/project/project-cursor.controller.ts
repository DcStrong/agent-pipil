/** Экран проекта читает и пишет .cursor. Живой API Cursor контроллер не вызывает. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  CursorFileDocument,
  CursorFileKind,
  CursorProjectView,
  CursorRecommendation,
} from '../runtime/cursor-files';
import { ProjectCursorService } from './project-cursor.service';

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Ожидался JSON-объект.');
  }
  return body as Record<string, unknown>;
}

function text(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new BadRequestException(message);
  return value;
}

function kindOf(value: unknown): CursorFileKind {
  if (value === 'rule' || value === 'skill' || value === 'mcp') return value;
  throw new BadRequestException('Группа: rule, skill или mcp.');
}

@Controller('project/cursor')
export class ProjectCursorController {
  constructor(private readonly project: ProjectCursorService) {}

  @Get()
  list(@Query('folder') folder?: string): CursorProjectView {
    return this.project.list(typeof folder === 'string' ? folder : '');
  }

  @Get('file')
  read(
    @Query('folder') folder?: string,
    @Query('kind') kind?: string,
    @Query('name') name?: string,
    @Query('path') path?: string,
  ): CursorFileDocument {
    return this.project.read(
      text(folder, 'Нужна папка проекта.'),
      kindOf(kind),
      text(name, 'Нужно имя файла.'),
      text(path, 'Нужен путь внутри .cursor.'),
    );
  }

  @Put('file')
  save(@Body() body: unknown): CursorFileDocument {
    const record = asRecord(body);
    const relativePath = record.relativePath;
    if (
      relativePath !== undefined &&
      relativePath !== null &&
      typeof relativePath !== 'string'
    ) {
      throw new BadRequestException('Путь файла должен быть строкой.');
    }
    return this.project.save(
      text(record.folder, 'Нужна папка проекта.'),
      kindOf(record.kind),
      text(record.name, 'Нужно имя файла.'),
      text(record.content, 'Нужен текст файла.'),
      typeof relativePath === 'string' ? relativePath : null,
    );
  }

  @Post('recommendation')
  addRecommendation(@Body() body: unknown): CursorRecommendation {
    const record = asRecord(body);
    return this.project.addRecommendation(
      text(record.folder, 'Нужна папка проекта.'),
    );
  }
}
