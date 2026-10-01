import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings/settings.service';

@Controller()
export class AppController {
  constructor(private readonly settings: SettingsService) {}

  @Get('health')
  health(): { ok: true; cursorConnected: boolean } {
    return { ok: true, cursorConnected: this.settings.cursorReady() };
  }
}
