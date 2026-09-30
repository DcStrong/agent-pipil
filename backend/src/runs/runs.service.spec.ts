import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { WorkflowsService } from '../workflows/workflows.service';
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
    workflows: WorkflowsService;
  }> {
    directory = await mkdtemp(join(tmpdir(), 'pipil-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        RunsService,
        WorkflowsService,
        SettingsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
      ],
    }).compile();
    return {
      runs: moduleRef.get(RunsService),
      settings: moduleRef.get(SettingsService),
      workflows: moduleRef.get(WorkflowsService),
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
    expect(finished.deepThinking).toBe(false);
    expect(finished.note).toBeNull();
    expect(finished.plan).toBeNull();
    expect(finished.archive).toBeNull();
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

  async function until(runs: RunsService, id: string, status: string) {
    let current = runs.get(id);
    for (
      let attempt = 0;
      attempt < 30 && current.status !== status;
      attempt += 1
    ) {
      await settle();
      current = runs.get(id);
    }
    return current;
  }

  it('даёт каждой роли новый диалог и ждёт ответ архитектора', async () => {
    const { runs } = await make();
    const first = runs.start(
      'workflow_supervised',
      'Нужен массив объектов заказов',
      {
        roleIds: [
          'role_architect',
          'role_developer',
          'role_orchestrator',
          'role_analyst',
        ],
      },
    );
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
    const orchestrator = waiting.steps.find(
      (step) => step.kind === 'orchestrator',
    );
    expect(architect?.messages.some((item) => item.author === 'user')).toBe(
      false,
    );
    expect(orchestrator?.messages.some((item) => item.author === 'user')).toBe(
      false,
    );
    expect(JSON.stringify(orchestrator?.messages)).not.toContain(
      'ОТВЕТ-ВЛАДЕЛЬЦА-77',
    );

    runs.answer(first.id, 'ОТВЕТ-ВЛАДЕЛЬЦА-77 нужен массив объектов');
    const done = await until(runs, first.id, 'completed');
    expect(done.status).toBe('completed');
    const architectDone = done.steps.find((step) => step.kind === 'architect');
    const orchestratorDone = done.steps.find(
      (step) => step.kind === 'orchestrator',
    );
    expect(
      architectDone?.messages.some(
        (item) =>
          item.author === 'user' && item.text.includes('ОТВЕТ-ВЛАДЕЛЬЦА-77'),
      ),
    ).toBe(true);
    expect(JSON.stringify(orchestratorDone?.messages)).not.toContain(
      'ОТВЕТ-ВЛАДЕЛЬЦА-77',
    );
    expect(
      orchestratorDone?.messages.some(
        (item) =>
          item.text.includes('не переписываю') ||
          item.text.includes('записал') ||
          item.text.includes('не пишу'),
      ),
    ).toBe(true);

    const second = runs.start(
      'workflow_supervised',
      'Вторая задача без старого чата',
      {
        roleIds: ['role_orchestrator', 'role_analyst'],
      },
    );
    expect(
      second.steps
        .map((step) => step.dialogueId)
        .some((id) => ids.includes(id)),
    ).toBe(false);
    await until(runs, second.id, 'completed');
  });

  it('не копирует .cursor в диалоги, а карту пишет только оркестратор', async () => {
    const { runs } = await make();
    const root = join(directory, 'proj');
    await mkdir(join(root, '.cursor', 'rules'), { recursive: true });
    await mkdir(join(root, '.cursor', 'skills', 'demo'), { recursive: true });
    await writeFile(
      join(root, '.cursor', 'rules', 'rule.mdc'),
      'SECRET_RULE_BODY',
    );
    await writeFile(
      join(root, '.cursor', 'skills', 'demo', 'SKILL.md'),
      'SKILL_SECRET',
    );
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
    expect(JSON.stringify(tester?.messages)).not.toContain(
      'Новый диалог этой задачи',
    );
    expect(
      tester?.messages.some((item) =>
        item.text.includes('Чужие диалоги не читал'),
      ),
    ).toBe(true);
    expect(
      tester?.messages.some((item) => item.text.includes('один объект')),
    ).toBe(true);
    const developer = done.steps.find((step) => step.kind === 'developer');
    expect(
      done.work.filter((item) => item.stepId === developer?.stepId),
    ).toHaveLength(2);
    expect(done.mapWritten).toBe(true);
    const map = await readFile(join(root, '.pipil', 'карта.md'), 'utf8');
    expect(map).toContain('Владение');
    expect(
      done.steps
        .filter((step) => step.kind !== 'orchestrator')
        .every((step) =>
          step.messages.every(
            (item) => !item.text.includes('записал её в конце'),
          ),
        ),
    ).toBe(true);
  });

  it('идёт по дереву и повторяет роль', async () => {
    const { runs, workflows } = await make();
    workflows.replace('workflow_supervised', 'Сборка с проверкой', 'Дерево', [
      {
        id: 'n1',
        agentId: 'role_orchestrator',
        title: 'Оркестратор',
        mode: 'automatic',
        handoff: 'дальше',
        nextIds: ['n2'],
      },
      {
        id: 'n2',
        agentId: 'role_analyst',
        title: 'Аналитик',
        mode: 'automatic',
        handoff: 'дальше',
        nextIds: ['n3'],
      },
      {
        id: 'n3',
        agentId: 'role_architect',
        title: 'Архитектор',
        mode: 'automatic',
        handoff: 'дальше',
        nextIds: ['n4'],
      },
      {
        id: 'n4',
        agentId: 'role_analyst',
        title: 'Аналитик ещё',
        mode: 'automatic',
        handoff: 'дальше',
        nextIds: ['n5'],
      },
      {
        id: 'n5',
        agentId: 'role_developer',
        title: 'Бэкенд',
        mode: 'automatic',
        handoff: 'дальше',
        nextIds: ['n6', 'n7'],
      },
      {
        id: 'n6',
        agentId: 'agent_reviewer',
        title: 'Проверка',
        mode: 'automatic',
        handoff: 'дальше',
        nextIds: [],
      },
      {
        id: 'n7',
        agentId: 'role_tester',
        title: 'Ветка',
        mode: 'automatic',
        handoff: '',
        nextIds: [],
      },
    ]);
    const started = runs.start('workflow_supervised', 'Короткий обход дерева');
    const done = await until(runs, started.id, 'completed');
    expect(done.status).toBe('completed');
    expect(done.work.map((item) => item.title)).toEqual([
      'Оркестратор',
      'Аналитик',
      'Архитектор',
      'Аналитик ещё',
      'Бэкенд',
      'Проверка',
      'Ветка',
    ]);
  });

  it('без галки агенты берут задачу сразу и не пишут план', async () => {
    const { runs, workflows } = await make();
    workflows.replace(
      'workflow_supervised',
      'Сборка с проверкой',
      'Прямой ход',
      [
        {
          id: 'r',
          agentId: 'agent_reviewer',
          title: 'Сверка',
          mode: 'review',
          handoff: 'дальше',
          nextIds: ['b'],
        },
        {
          id: 'b',
          agentId: 'agent_builder',
          title: 'Сборка',
          mode: 'build',
          handoff: 'дальше',
          nextIds: ['a'],
        },
        {
          id: 'a',
          agentId: 'role_analyst',
          title: 'Смотреть',
          mode: 'ask',
          handoff: 'дальше',
          nextIds: ['p'],
        },
        {
          id: 'p',
          agentId: 'agent_planner',
          title: 'План',
          mode: 'plan',
          handoff: '',
          nextIds: [],
        },
      ],
    );
    const started = runs.start(
      'workflow_supervised',
      'Поправить подпись кнопки',
    );
    const done = await until(runs, started.id, 'completed');
    expect(done.status).toBe('completed');
    expect(done.deepThinking).toBe(false);
    expect(done.note).toBeNull();
    expect(done.plan).toBeNull();
    expect(done.buildText).toBeNull();
    expect(done.reviewText).toBeNull();
    expect(done.archive).toBeNull();
    expect(done.work.map((item) => item.title)).toEqual([
      'Сверка',
      'Сборка',
      'Смотреть',
      'План',
    ]);
  });

  it('глубокое мышление показывает части, даёт править план и кладёт их в архив', async () => {
    const previousLive = process.env.CURSOR_LIVE;
    process.env.CURSOR_LIVE = '1';
    try {
      const { runs } = await make();
      const root = join(directory, 'proj');
      await mkdir(join(root, 'src'), { recursive: true });
      await mkdir(join(root, '.cursor', 'rules'), { recursive: true });
      await writeFile(
        join(root, 'src', 'orders.ts'),
        'export const SECRET_CODE_BODY = 1\nfunction leak() { return 1 }\n',
      );
      await writeFile(
        join(root, '.cursor', 'rules', 'rule.mdc'),
        'SECRET_RULE_BODY',
      );
      const started = runs.start(
        'workflow_supervised',
        'Добавить выгрузку заказов',
        {
          projectPath: root,
          deepThinking: true,
        },
      );
      const waiting = await until(runs, started.id, 'waiting_plan');
      expect(waiting.status).toBe('waiting_plan');
      expect(waiting.error).toBeNull();
      expect(waiting.note).toContain('Короткая заметка о том, что уже есть.');
      expect(waiting.note).not.toContain('SECRET_CODE_BODY');
      expect(waiting.note).not.toContain('SECRET_RULE_BODY');
      expect(waiting.note).not.toContain('function leak');
      expect(waiting.plan?.why).toBeTruthy();
      expect(waiting.plan?.changes).toBeTruthy();
      expect(waiting.plan?.how).toBeTruthy();
      expect(waiting.plan?.checklist).toContain('чеклист');
      expect(waiting.buildText).toBeNull();
      expect(waiting.archive).toBeNull();
      const noteFile = await readFile(
        join(root, '.pipil', 'tasks', started.id, 'заметка.md'),
        'utf8',
      );
      expect(noteFile).toContain('Короткая заметка о том, что уже есть.');
      expect(noteFile).not.toContain('SECRET_CODE_BODY');

      expect(() =>
        runs.savePlan(started.id, {
          why: 'МЕТКА-ПЛАНА-УНИКАЛЬНАЯ',
          changes: 'Меняется выгрузка',
          how: 'По чеклисту',
          checklist: '-',
        }),
      ).toThrow('чеклист');

      runs.savePlan(started.id, {
        why: 'МЕТКА-ПЛАНА-УНИКАЛЬНАЯ',
        changes: 'Меняется выгрузка',
        how: 'По чеклисту',
        checklist: '- ПУНКТ-ЧЕКЛИСТА-42',
      });
      const done = await until(runs, started.id, 'completed');
      expect(done.status).toBe('completed');
      expect(done.error).toBeNull();
      expect(done.plan).toEqual({
        why: 'МЕТКА-ПЛАНА-УНИКАЛЬНАЯ',
        changes: 'Меняется выгрузка',
        how: 'По чеклисту',
        checklist: '- ПУНКТ-ЧЕКЛИСТА-42',
      });
      expect(done.buildText).toContain('Контекст сборки — план.');
      expect(done.buildText).toContain('МЕТКА-ПЛАНА-УНИКАЛЬНАЯ');
      expect(done.buildText).toContain('Сделано: ПУНКТ-ЧЕКЛИСТА-42');
      expect(done.buildText).not.toContain(
        'Короткая заметка о том, что уже есть.',
      );
      expect(done.reviewText).toContain('Сверка по чеклисту.');
      expect(done.reviewText).toContain('Есть в результате: ПУНКТ-ЧЕКЛИСТА-42');
      expect(done.reviewText).not.toContain(
        'Короткая заметка о том, что уже есть.',
      );
      expect(done.archive?.note).toContain(
        'Короткая заметка о том, что уже есть.',
      );
      expect(done.archive?.plan.why).toBe('МЕТКА-ПЛАНА-УНИКАЛЬНАЯ');
      expect(done.archive?.result).toContain('ПУНКТ-ЧЕКЛИСТА-42');
      expect(done.archive?.result).not.toContain(
        'Короткая заметка о том, что уже есть.',
      );
      const checklistFile = await readFile(
        join(root, '.pipil', 'tasks', started.id, 'чеклист.md'),
        'utf8',
      );
      const archived = await readFile(
        join(root, '.pipil', 'tasks', started.id, 'архив', 'итог.md'),
        'utf8',
      );
      expect(checklistFile).toContain('ПУНКТ-ЧЕКЛИСТА-42');
      expect(archived).toContain('ПУНКТ-ЧЕКЛИСТА-42');
      expect(archived).not.toContain('SECRET_CODE_BODY');

      const second = runs.start('workflow_supervised', 'Следующий диалог', {
        roleIds: ['role_orchestrator', 'role_analyst'],
        projectPath: root,
      });
      const next = await until(runs, second.id, 'completed');
      const blob = JSON.stringify(next.steps.map((step) => step.messages));
      expect(blob).not.toContain('МЕТКА-ПЛАНА-УНИКАЛЬНАЯ');
      expect(blob).not.toContain('ПУНКТ-ЧЕКЛИСТА-42');
      expect(blob).not.toContain('SECRET_CODE_BODY');
      expect(next.note).toBeNull();
      expect(next.archive).toBeNull();
    } finally {
      if (previousLive === undefined) delete process.env.CURSOR_LIVE;
      else process.env.CURSOR_LIVE = previousLive;
    }
  });

  it('режим шага выбирает кусок, а кто стоит на шаге остаётся деревом холста', async () => {
    const { runs, workflows } = await make();
    workflows.replace('workflow_supervised', 'Сборка с проверкой', 'Дерево', [
      {
        id: 'r',
        agentId: 'agent_reviewer',
        title: 'Сверка',
        mode: 'review',
        handoff: 'дальше',
        nextIds: ['b'],
      },
      {
        id: 'b',
        agentId: 'agent_builder',
        title: 'Сборка',
        mode: 'build',
        handoff: 'дальше',
        nextIds: ['a'],
      },
      {
        id: 'a',
        agentId: 'role_analyst',
        title: 'Смотреть',
        mode: 'ask',
        handoff: 'дальше',
        nextIds: ['p'],
      },
      {
        id: 'p',
        agentId: 'agent_planner',
        title: 'План',
        mode: 'plan',
        handoff: '',
        nextIds: [],
      },
    ]);
    const started = runs.start(
      'workflow_supervised',
      'Собрать карточку заказа',
      {
        deepThinking: true,
      },
    );
    expect(started.steps.map((step) => step.title)).toEqual([
      'Сверка',
      'Сборка',
      'Смотреть',
      'План',
    ]);
    const waiting = await until(runs, started.id, 'waiting_plan');
    expect(waiting.work.map((item) => item.title)).toEqual(['Смотреть']);
    expect(
      waiting.steps
        .find((step) => step.mode === 'ask')
        ?.messages.map((item) => item.text)
        .join('\n'),
    ).toContain('Короткая заметка о том, что уже есть.');
    expect(
      waiting.steps.find((step) => step.mode === 'build')?.messages,
    ).toEqual([]);
    runs.savePlan(started.id, {
      why: 'Нужна карточка',
      changes: 'Появляется карточка заказа',
      how: 'Собрать по чеклисту',
      checklist: '- Карточка на месте',
    });
    const done = await until(runs, started.id, 'completed');
    expect(done.steps.map((step) => step.agentName)).toEqual([
      'Ревьюер',
      'Сборщик',
      'Аналитик',
      'Планировщик',
    ]);
    expect(done.work.map((item) => item.title)).toEqual([
      'Смотреть',
      'План',
      'Сборка',
      'Сверка',
    ]);
    expect(done.work.map((item) => item.agentName)).toEqual([
      'Аналитик',
      'Планировщик',
      'Сборщик',
      'Ревьюер',
    ]);
    const build = done.steps.find((step) => step.mode === 'build');
    const ask = done.steps.find((step) => step.mode === 'ask');
    expect(build?.messages.map((item) => item.text).join('\n')).toContain(
      'Контекст сборки — план.',
    );
    expect(build?.messages.map((item) => item.text).join('\n')).toContain(
      'Сделано: Карточка на месте',
    );
    expect(build?.messages.map((item) => item.text).join('\n')).not.toContain(
      'Короткая заметка о том, что уже есть.',
    );
    expect(ask?.messages.map((item) => item.text).join('\n')).not.toContain(
      'Контекст сборки — план.',
    );
    expect(
      done.steps
        .find((step) => step.mode === 'review')
        ?.messages.map((item) => item.text)
        .join('\n'),
    ).toContain('Сверка по чеклисту.');
    expect(done.archive?.plan.checklist).toContain('Карточка на месте');
  });
});
