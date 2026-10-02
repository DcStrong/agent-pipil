import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import type { CursorConnectionMode } from '../domain';
import { SettingsService, type CursorConnection } from './settings.service';

@Controller('settings/cursor')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get(): Promise<CursorConnection> {
    return this.settings.connectionView();
  }

  @Put()
  save(@Body() body: unknown): CursorConnection {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Ожидался JSON-объект.');
    }
    const record = body as { token?: unknown; apiKey?: unknown };
    if (typeof record.apiKey === 'string') {
      return this.settings.saveCliApiKey(record.apiKey);
    }
    const token = record.token;
    if (typeof token !== 'string') {
      throw new BadRequestException('Нужно поле token или apiKey.');
    }
    return this.settings.save(token);
  }

  @Delete()
  clear(): CursorConnection {
    return this.settings.clear();
  }

  @Post('cli/login')
  async startCliLogin(): Promise<CursorConnection> {
    return this.settings.startCliLogin();
  }

  @Post('cli/logout')
  async logoutCliSession(): Promise<CursorConnection> {
    return this.settings.logoutCliSession();
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
