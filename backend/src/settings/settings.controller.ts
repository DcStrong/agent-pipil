import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Put,
} from '@nestjs/common';
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
}
