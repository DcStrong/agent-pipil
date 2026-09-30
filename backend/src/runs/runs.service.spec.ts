import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
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

  async function until(
    runs: RunsService,
    id: string,
    status: string,
  ) {
    let current = runs.get(id);
    for (let attempt = 0; attempt < 30 && current.status !== status; attempt += 1) {
      await settle();
      current = runs.get(id);
    }
    return current;
  }

  it('даёт каждой роли новый диалог и ждёт ответ архитектора', async () => {
    const { runs } = await make();
    const first = runs.start('workflow_supervised', 'Нужен массив объектов заказов', {
      roleIds: ['role_architect', 'role_developer', 'role_orchestrator', 'role_analyst'],
    });
    expect(first.steps.map((step) => step.kind)).toEqual([
      'orchestrator',
      'analyst',
      'architect',
      'developer',
    ]);
    const ids = first.steps.map((step) => step.dialogueId);
    expect(new Set(ids).size).toBe(4);

    const waiting = await until(runs, first.id, 'waiting_user');
    expect(waiting.status).toBe('waiting_user');
    expect(waiting.pendingQuestion).toContain('массив объектов');
    const architect = waiting.steps.find((step) => step.kind === 'architect');
    const orchestrator = waiting.steps.find((step) => step.kind === 'orchestrator');
    expect(architect?.messages.some((item) => item.author === 'user')).toBe(false);
    expect(orchestrator?.messages.some((item) => item.author === 'user')).toBe(false);
    expect(JSON.stringify(orchestrator?.messages)).not.toContain('ОТВЕТ-ВЛАДЕЛЬЦА-77');

    runs.answer(first.id, 'ОТВЕТ-ВЛАДЕЛЬЦА-77 нужен массив объектов');
    const done = await until(runs, first.id, 'completed');
    expect(done.status).toBe('completed');
    const architectDone = done.steps.find((step) => step.kind === 'architect');
    const orchestratorDone = done.steps.find((step) => step.kind === 'orchestrator');
    expect(architectDone?.messages.some((item) => item.author === 'user' && item.text.includes('ОТВЕТ-ВЛАДЕЛЬЦА-77'))).toBe(true);
    expect(JSON.stringify(orchestratorDone?.messages)).not.toContain('ОТВЕТ-ВЛАДЕЛЬЦА-77');
    expect(
      orchestratorDone?.messages.some(
        (item) =>
          item.text.includes('не переписываю') ||
          item.text.includes('записал') ||
          item.text.includes('не пишу'),
      ),
    ).toBe(true);

    const second = runs.start('workflow_supervised', 'Вторая задача без старого чата', {
      roleIds: ['role_orchestrator', 'role_analyst'],
    });
    expect(second.steps.map((step) => step.dialogueId).some((id) => ids.includes(id))).toBe(false);
    await until(runs, second.id, 'completed');
  });

  it('не копирует .cursor в диалоги, а карту пишет только оркестратор', async () => {
    const { runs } = await make();
    const root = join(directory, 'proj');
    await mkdir(join(root, '.cursor', 'rules'), { recursive: true });
    await mkdir(join(root, '.cursor', 'skills', 'demo'), { recursive: true });
    await writeFile(join(root, '.cursor', 'rules', 'rule.mdc'), 'SECRET_RULE_BODY');
    await writeFile(join(root, '.cursor', 'skills', 'demo', 'SKILL.md'), 'SKILL_SECRET');
    const started = runs.start('workflow_supervised', 'нужен массив объектов', {
      roleIds: ['role_orchestrator', 'role_developer', 'role_tester'],
      projectPath: root,
    });
    const done = await until(runs, started.id, 'completed');
    expect(done.status).toBe('completed');
    const blob = JSON.stringify(done.steps.map((step) => step.messages));
    expect(blob).not.toContain('SECRET_RULE_BODY');
    expect(blob).not.toContain('SKILL_SECRET');
    expect(blob).toContain('.cursor/rules/rule.mdc');
    expect(blob).toContain('.cursor/skills/demo/SKILL.md');
    const tester = done.steps.find((step) => step.kind === 'tester');
    expect(JSON.stringify(tester?.messages)).not.toContain('Новый диалог этой задачи');
    expect(tester?.messages.some((item) => item.text.includes('Чужие диалоги не читал'))).toBe(true);
    expect(tester?.messages.some((item) => item.text.includes('один объект'))).toBe(true);
    const developer = done.steps.find((step) => step.kind === 'developer');
    expect(done.work.filter((item) => item.stepId === developer?.stepId)).toHaveLength(2);
    expect(done.mapWritten).toBe(true);
    const map = await readFile(join(root, '.pipil', 'карта.md'), 'utf8');
    expect(map).toContain('Владение');
    expect(done.steps.filter((step) => step.kind !== 'orchestrator').every((step) =>
      step.messages.every((item) => !item.text.includes('записал её в конце')),
    )).toBe(true);
  });
});
