import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSeedState,
  seedPresets,
  type AgentKind,
  type Run,
  type StepMode,
} from '../domain';
import { ProjectsService } from '../projects/projects.service';
import { RunsService } from '../runs/runs.service';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { PresetsService } from './presets.service';

const CODE_KINDS: AgentKind[] = ['developer', 'builder', 'tester'];

describe('PresetsService', () => {
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
    directory = '';
  });

  async function make(): Promise<{
    presets: PresetsService;
    runs: RunsService;
    store: StoreService;
  }> {
    directory = await mkdtemp(join(tmpdir(), 'pipil-presets-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        PresetsService,
        RunsService,
        ProjectsService,
        SettingsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
      ],
    }).compile();
    return {
      presets: moduleRef.get(PresetsService),
      runs: moduleRef.get(RunsService),
      store: moduleRef.get(StoreService),
    };
  }

  function kindsOf(presetId: string): AgentKind[] {
    const preset = seedPresets().find((item) => item.id === presetId);
    if (!preset) throw new Error(presetId);
    return preset.steps.map((step) => step.kind);
  }

  function modesOf(presetId: string): StepMode[] {
    const preset = seedPresets().find((item) => item.id === presetId);
    if (!preset) throw new Error(presetId);
    return preset.steps.map((step) => step.mode);
  }

  it('отдаёт шесть встроенных цепочек в заданном порядке ролей', async () => {
    const { presets, store } = await make();
    const listed = presets.list();
    expect(listed.map((item) => item.name)).toEqual([
      'Фича',
      'Тестирование',
      'Рефакторинг',
      'План',
      'Баг',
      'Вопрос',
    ]);
    expect(listed.every((item) => item.builtin)).toBe(true);

    expect(kindsOf('preset_feature')).toEqual([
      'orchestrator',
      'analyst',
      'architect',
      'developer',
      'reviewer',
    ]);
    expect(kindsOf('preset_testing')).toEqual([
      'developer',
      'tester',
      'reviewer',
    ]);
    expect(kindsOf('preset_refactor')).toEqual(['developer', 'reviewer']);
    expect(kindsOf('preset_refactor')).not.toContain('analyst');
    expect(kindsOf('preset_refactor')).not.toContain('architect');
    expect(kindsOf('preset_plan')).toEqual([
      'orchestrator',
      'analyst',
      'architect',
    ]);
    expect(
      kindsOf('preset_plan').some((kind) => CODE_KINDS.includes(kind)),
    ).toBe(false);
    expect(kindsOf('preset_bug')).toEqual(['analyst', 'developer', 'tester']);
    expect(kindsOf('preset_question')).toEqual(['orchestrator']);
    expect(modesOf('preset_question')).toEqual(['question']);
    expect(
      kindsOf('preset_question').some((kind) =>
        ['developer', 'builder'].includes(kind),
      ),
    ).toBe(false);

    const agents = new Map(
      store.read().agents.map((agent) => [agent.id, agent.kind]),
    );
    for (const preset of listed) {
      const opened = presets.open(preset.id);
      expect(opened.name).toBe(preset.name);
      expect(opened.steps.map((step) => agents.get(step.agentId))).toEqual(
        preset.steps.map((step) => step.kind),
      );
      expect(opened.steps.map((step) => step.mode)).toEqual(
        preset.steps.map((step) => step.mode),
      );
      expect(opened.steps.map((step) => step.title)).toEqual(
        preset.steps.map((step) => step.title),
      );
      for (let index = 0; index < opened.steps.length - 1; index += 1) {
        expect(opened.steps[index]?.nextIds).toEqual([
          opened.steps[index + 1]?.id,
        ]);
      }
      expect(opened.steps.at(-1)?.nextIds).toEqual([]);
    }
  });

  it('сохраняет текущее дерево и снова ставит его на холст', async () => {
    const { presets, store } = await make();
    const agents = store.read().agents;
    const developer = agents.find((agent) => agent.kind === 'developer');
    const tester = agents.find((agent) => agent.kind === 'tester');
    const reviewer = agents.find((agent) => agent.kind === 'reviewer');
    if (!developer || !tester || !reviewer) throw new Error('роли');
    const saved = presets.save('Моя ветка', '', [
      {
        key: 'dev',
        agentId: developer.id,
        title: 'Правка',
        mode: 'automatic',
        handoff: 'Передай правку в обе ветки.',
        nextKeys: ['test', 'review'],
      },
      {
        key: 'test',
        agentId: tester.id,
        title: 'Прогон',
        mode: 'automatic',
        handoff: '',
        nextKeys: [],
      },
      {
        key: 'review',
        agentId: reviewer.id,
        title: 'Сверка',
        mode: 'approval',
        handoff: '',
        nextKeys: [],
      },
    ]);
    expect(saved.builtin).toBe(false);
    expect(presets.list().map((item) => item.name)).toContain('Моя ветка');

    const again = presets.stepsFor(saved.id);
    expect(again.name).toBe('Моя ветка');
    expect(again.steps.map((step) => step.title)).toEqual([
      'Правка',
      'Прогон',
      'Сверка',
    ]);
    expect(again.steps.map((step) => step.agentId)).toEqual([
      developer.id,
      tester.id,
      reviewer.id,
    ]);
    expect(again.steps[0]?.nextIds).toEqual([
      again.steps[1]?.id,
      again.steps[2]?.id,
    ]);
    expect(new Set(again.steps.map((step) => step.id)).size).toBe(3);

    const workflow = presets.open(saved.id);
    expect(workflow.steps.map((step) => step.title)).toEqual([
      'Правка',
      'Прогон',
      'Сверка',
    ]);
    expect(workflow.id).not.toBe(saved.id);
  });

  it('не даёт занять имя встроенного пресета и не удаляет его', async () => {
    const { presets } = await make();
    expect(() => presets.save('Фича', '', [])).toThrow(BadRequestException);
    expect(() => presets.remove('preset_feature')).toThrow(BadRequestException);
    expect(presets.list().some((item) => item.id === 'preset_feature')).toBe(
      true,
    );
  });

  it('open не добавляет процесс в store — только черновик для холста', async () => {
    const { presets, store } = await make();
    const before = store.read().workflows.length;
    presets.open('preset_feature');
    expect(store.read().workflows.length).toBe(before);
  });

  it('запуск с пресета остаётся имитацией и не включает живой Cursor', async () => {
    const { presets, runs, store } = await make();
    const workflow = presets.open('preset_question');
    store.mutate((state) => {
      state.workflows.push(workflow);
    });
    expect(workflow.steps).toHaveLength(1);
    expect(workflow.steps[0]?.mode).toBe('question');
    const started = runs.start(workflow.id, 'Почему падает сборка?');
    expect(started.steps.every((step) => step.harness === 'simulated')).toBe(
      true,
    );
    expect(started.steps.map((step) => step.kind)).toEqual(['orchestrator']);

    let current = started;
    for (
      let attempt = 0;
      attempt < 40 && current.status === 'running';
      attempt += 1
    ) {
      current = runs.get(started.id);
      if (current.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(current.status).toBe('completed');
    expect(current.steps.every((step) => step.harness === 'simulated')).toBe(
      true,
    );
    const text = JSON.stringify(current satisfies Run);
    expect(text).not.toContain('api.cursor.com');
    expect(text).not.toContain('Живой вызов Cursor');
  });

  it('дописывает встроенные пресеты в старый файл без поля presets', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipil-presets-'));
    const path = join(directory, 'state.json');
    const seed = createSeedState() as { presets?: unknown };
    delete seed.presets;
    await writeFile(path, JSON.stringify(seed));
    const store = new StoreService(path);
    expect(store.read().presets.map((item) => item.name)).toEqual([
      'Фича',
      'Тестирование',
      'Рефакторинг',
      'План',
      'Баг',
      'Вопрос',
    ]);
    expect(store.read().workflows.map((item) => item.name)).toContain(
      'Сборка с проверкой',
    );
    await store.whenSaved();
  });
});
