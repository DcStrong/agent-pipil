import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
} from '@nestjs/common';
import type { CursorConnectionMode } from '../domain';
import { SettingsService, type CursorConnection } from './settings.service';

@Controller('settings/cursor')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): CursorConnection {
    return this.settings.connection();
  }

  @Put()
  save(@Body() body: unknown): CursorConnection {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const token = (body as { token?: unknown }).token;
    if (typeof token !== 'string')
      throw new BadRequestException('Нужно поле token.');
    return this.settings.save(token);
  }

  @Delete()
  clear(): CursorConnection {
    return this.settings.clear();
  }

  @Patch('mode')
  setMode(@Body() body: unknown): CursorConnection {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const mode = (body as { mode?: unknown }).mode;
    if (mode !== 'cli' && mode !== 'api') {
      throw new BadRequestException('Нужно поле mode: cli или api.');
    }
    return this.settings.setMode(mode as CursorConnectionMode);
  }
}
