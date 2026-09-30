import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { RunsService } from './runs.service';

async function settle(): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('RunsService', () => {
  let directory = '';
  let moduleRef: TestingModule | undefined;
  const previousDelay = process.env.SIM_DELAY_MS;
  const previousLive = process.env.CURSOR_LIVE;
  const previousToken = process.env.CURSOR_API_TOKEN;

  beforeAll(() => {
    process.env.SIM_DELAY_MS = '0';
    delete process.env.CURSOR_LIVE;
    delete process.env.CURSOR_API_TOKEN;
  });

  afterAll(() => {
    if (previousDelay === undefined) delete process.env.SIM_DELAY_MS;
    else process.env.SIM_DELAY_MS = previousDelay;
    if (previousLive === undefined) delete process.env.CURSOR_LIVE;
    else process.env.CURSOR_LIVE = previousLive;
    if (previousToken === undefined) delete process.env.CURSOR_API_TOKEN;
    else process.env.CURSOR_API_TOKEN = previousToken;
  });

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.get(StoreService).whenSaved();
      await moduleRef.close();
      moduleRef = undefined;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function make(): Promise<{
    runs: RunsService;
    settings: SettingsService;
  }> {
    directory = await mkdtemp(join(tmpdir(), 'pipil-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        RunsService,
        SettingsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
      ],
    }).compile();
    return {
      runs: moduleRef.get(RunsService),
      settings: moduleRef.get(SettingsService),
    };
  }

  it('останавливается на проверке и после подтверждения отдаёт итог', async () => {
    const { runs } = await make();
    const started = runs.start(
      'workflow_supervised',
      'Добавить тихий режим уведомлений',
    );
    expect(started.status).toBe('running');
    expect(started.stepIndex).toBe(0);
    expect(() => runs.start('workflow_supervised', 'Вторая задача')).toThrow(
      ConflictException,
    );

    let current = started;
    for (
      let attempt = 0;
      attempt < 20 && current.status === 'running';
      attempt += 1
    ) {
      await settle();
      current = runs.get(started.id);
    }
    expect(current.status).toBe('waiting_approval');
    expect(current.work.map((item) => item.title)).toEqual([
      'План',
      'Сборка',
      'Проверка',
    ]);
    expect(current.steps[0]?.skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(['Держать рамку', 'Отделить факты']),
    );
    expect(current.steps[1]?.skills.map((skill) => skill.name)).not.toContain(
      'Отделить факты',
    );

    runs.decide(started.id, true);
    for (
      let attempt = 0;
      attempt < 20 && runs.get(started.id).status !== 'completed';
      attempt += 1
    ) {
      await settle();
    }
    const finished = runs.get(started.id);
    expect(finished.status).toBe('completed');
    expect(finished.finalResult).toContain('Добавить тихий режим уведомлений');
    expect(finished.finalResult).toContain('## Итог');
  });

  it('отклонение владельца останавливает запуск', async () => {
    const { runs } = await make();
    const started = runs.start('workflow_supervised', 'Короткий запуск');
    for (
      let attempt = 0;
      attempt < 20 && runs.get(started.id).status === 'running';
      attempt += 1
    ) {
      await settle();
    }
    runs.decide(started.id, false);
    await settle();
    const finished = runs.get(started.id);
    expect(finished.status).toBe('failed');
    expect(finished.error).toContain('отклонил');
    expect(finished.finalResult).toBeNull();
  });

  it('сохраняет токен Cursor и не возвращает его целиком', async () => {
    const { settings } = await make();
    const secret = 'cursor_live_token_value';
    const saved = settings.save(secret);
    expect(saved).toEqual({
      connected: true,
      source: 'saved',
      hint: '••••alue',
    });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(settings.clear()).toEqual({
      connected: false,
      source: 'none',
      hint: null,
    });
  });
});
