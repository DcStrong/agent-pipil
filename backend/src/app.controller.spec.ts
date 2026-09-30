import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';
import { SettingsService } from './settings/settings.service';

describe('AppController', () => {
  it('сообщает, что Cursor не подключён', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: SettingsService,
          useValue: { hasToken: () => false },
        },
      ],
    }).compile();
    const controller = moduleRef.get(AppController);
    expect(controller.health()).toEqual({ ok: true, cursorConnected: false });
  });
});
