import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentsService } from '../agents/agents.service';
import { ProjectsService } from '../projects/projects.service';
import { RunsService } from '../runs/runs.service';
import { CursorClient } from '../runtime/cursor-client';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { WorkflowsService } from '../workflows/workflows.service';
import { BoardService } from './board.service';

function installCursorFetchMock(): () => void {
  const original = globalThis.fetch;
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/agents') && init?.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          agent: { id: 'bc-board-mock', url: 'https://cursor.com/agents/bc-board-mock' },
          run: { id: 'run-board-mock' },
        }),
      } as Response;
    }
    if (url.includes('/runs/run-board-mock')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'FINISHED',
          result: 'Ответ для теста доски.',
        }),
      } as Response;
    }
    if (original) return original(url, init);
    throw new Error(`Неожиданный fetch: ${url}`);
  });
  globalThis.fetch = fetchMock as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function settle(): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('BoardService', () => {
  let directory = '';
  let moduleRef: TestingModule | undefined;
  const previousDelay = process.env.SIM_DELAY_MS;
  let restoreFetch: (() => void) | undefined;

  beforeAll(() => {
    process.env.SIM_DELAY_MS = '0';
    restoreFetch = installCursorFetchMock();
  });

  afterAll(() => {
    restoreFetch?.();
    if (previousDelay === undefined) delete process.env.SIM_DELAY_MS;
    else process.env.SIM_DELAY_MS = previousDelay;
  });

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.get(StoreService).whenSaved();
      await moduleRef.close();
      moduleRef = undefined;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function seedProject(store: StoreService, folder: string): string {
    const id = randomUUID();
    store.mutate((state) => {
      state.projects.push({
        id,
        kind: 'folder',
        path: folder,
        folderName: 'test-proj',
        alias: '',
      });
    });
    return id;
  }

  async function make(path = ''): Promise<{
    board: BoardService;
    agents: AgentsService;
    settings: SettingsService;
    store: StoreService;
    projectId: string;
  }> {
    if (!path) directory = await mkdtemp(join(tmpdir(), 'pipil-board-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        BoardService,
        RunsService,
        ProjectsService,
        WorkflowsService,
        AgentsService,
        SettingsService,
        StoreService,
        { provide: DATA_PATH, useValue: path || join(directory, 'state.json') },
      ],
    }).compile();
    const store = moduleRef.get(StoreService);
    const settings = moduleRef.get(SettingsService);
    settings.save('cursor_board_test_token_value');
    const projectId = seedProject(store, path || directory);
    return {
      board: moduleRef.get(BoardService),
      agents: moduleRef.get(AgentsService),
      settings,
      store,
      projectId,
    };
  }

  it('создаёт несколько задач в колонке new и по переносу запускает команду', async () => {
    const { board, projectId } = await make();
    const first = board.create('Выгрузка', 'Нужен массив заказов', {
      projectId,
      team: [{ agentId: 'role_architect' }, { agentId: 'role_developer' }],
    });
    const second = board.create('Подсказка', 'Короткий вопрос', {
      projectId,
      team: [{ agentId: 'role_tester', mode: 'ask' }],
    });
    expect(board.list().map((task) => task.status)).toEqual(['new', 'new']);
    expect(first.phase).toBe('idle');
    expect(second.team[0]?.mode).toBe('ask');

    const moved = board.move(first.id, 'in_progress');
    expect(moved.status).toBe('in_progress');
    expect(moved.activity.map((item) => item.state)).toEqual([
      'working',
      'working',
    ]);
    expect(
      moved.activity.every((item) => item.note.includes('Взял задачу')),
    ).toBe(true);

    await settle();
    const planned = board.get(first.id);
    expect(planned.phase).toBe('plan');
    expect(planned.status).toBe('in_progress');
    expect(planned.plan?.authorName).toBe('Архитектор');
    expect(planned.plan?.editable).toBe(true);
    expect(
      planned.activity.find((item) => item.agentName === 'Бэкенд-разработчик')
        ?.state,
    ).toBe('waiting');
  });

  it('не пускает на проверку мимо плана и сборки, правку отдаёт в сборку', async () => {
    const { board, projectId } = await make();
    const task = board.create('Контракт', 'Один объект', {
      projectId,
      team: [
        { agentId: 'agent_planner', mode: 'plan' },
        { agentId: 'role_architect', mode: 'plan' },
        { agentId: 'agent_builder', mode: 'agent' },
        { agentId: 'agent_reviewer', mode: 'agent' },
      ],
    });
    expect(() => board.move(task.id, 'review')).toThrow(BadRequestException);
    expect(board.get(task.id).status).toBe('new');
    expect(() => board.handToBuild(task.id)).toThrow(/план/i);

    board.move(task.id, 'in_progress');
    expect(() => board.handToBuild(task.id)).toThrow(/план/i);
    await settle();

    const planned = board.get(task.id);
    expect(planned.plan?.authorName).toBe('Архитектор');
    const edited = 'Свой текст плана\nСобрать один объект.';
    expect(board.updatePlan(task.id, edited).plan?.text).toBe(edited);

    const building = board.handToBuild(task.id);
    expect(building.phase).toBe('build');
    expect(building.status).toBe('in_progress');
    expect(building.plan?.editable).toBe(false);
    expect(building.plan?.text).toBe(edited);
    expect(() => board.updatePlan(task.id, 'Поздняя правка')).toThrow(
      BadRequestException,
    );

    await settle();
    const done = board.get(task.id);
    expect(done.status).toBe('review');
    expect(done.phase).toBe('done');
    expect(
      done.activity.find((item) => item.agentName === 'Сборщик')?.note,
    ).toContain('Собрал');
    expect(
      done.activity.find((item) => item.agentName === 'Ревьюер')?.note,
    ).toContain('Сверил');
  });

  it('режим вопроса заканчивается проверкой и не требует плана', async () => {
    const { board, projectId } = await make();
    const task = board.create('Спросить', 'Что уже есть в проекте?', {
      projectId,
      team: [
        { agentId: 'role_analyst', mode: 'ask' },
        { agentId: 'role_tester', mode: 'ask' },
      ],
    });
    board.move(task.id, 'in_progress');
    await settle();
    const done = board.get(task.id);
    expect(done.plan).toBeNull();
    expect(done.status).toBe('review');
    expect(
      done.activity.every((item) => item.note.includes('режиме вопроса')),
    ).toBe(true);
  });

  it('план может составить не архитектор, а любой агент в режиме плана', async () => {
    const { board, agents, projectId } = await make();
    const custom = agents.create(
      'Исследователь',
      'custom',
      'Смотрю задачу и пишу план.',
      'simulated',
    );
    const task = board.create('Чужой план', 'Нужна схема', {
      projectId,
      team: [
        { agentId: 'role_architect', mode: 'ask' },
        { agentId: custom.id, mode: 'plan' },
      ],
    });
    board.move(task.id, 'in_progress');
    await settle();
    expect(board.get(task.id).plan?.authorName).toBe('Исследователь');
    expect(board.get(task.id).plan?.text).toContain('Чужой план');
  });

  it('сохранённый токен и среда Cursor не вызывают живой API', async () => {
    const spy = jest.spyOn(CursorClient.prototype, 'runStep');
    const fetchMock = jest.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const { board, settings, projectId } = await make();
      settings.save('cursor_secret_token');
      const task = board.create('Живой не нужен', 'Собрать ручку', {
        projectId,
        team: [
          { agentId: 'role_architect', mode: 'plan' },
          { agentId: 'agent_builder', mode: 'agent' },
        ],
      });
      const moved = board.move(task.id, 'in_progress');
      expect(
        moved.activity.find((item) => item.agentName === 'Сборщик')?.note,
      ).toContain('имитируется');
      await settle();
      board.handToBuild(task.id, 'План без сети.\nСделать ручку.');
      await settle();
      const done = board.get(task.id);
      expect(done.status).toBe('review');
      expect(done.activity.map((item) => item.note).join('\n')).not.toContain(
        'Живой вызов',
      );
      expect(spy).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
      spy.mockRestore();
    }
  });

  it('при переносе в работу стартует запуск с projectId задачи', async () => {
    const { board, projectId, store } = await make();
    const task = board.create('Старт', 'Текст задачи', {
      projectId,
      team: [{ agentId: 'role_analyst', mode: 'ask' }],
    });
    board.move(task.id, 'in_progress');
    const updated = board.get(task.id);
    expect(updated.runId).toBeTruthy();
    const project = store.read().projects.find((item) => item.id === projectId);
    const run = store.read().runs.find((item) => item.id === updated.runId);
    expect(run?.project?.folder).toBe(project?.path);
    expect(run?.task).toContain('Старт');
  });

  it('не переводит в работу задачу без projectId', async () => {
    const { board, store, projectId } = await make();
    const task = board.create('Без проекта', '', {
      projectId,
      team: [{ agentId: 'role_analyst' }],
    });
    store.mutate((state) => {
      const row = state.tasks.find((item) => item.id === task.id);
      if (row) row.projectId = '';
    });
    expect(() => board.move(task.id, 'in_progress')).toThrow(/проект|workspace/i);
  });

  it('без проекта или без исполнителей не создаёт задачу', async () => {
    const { board, projectId } = await make();
    expect(() =>
      board.create('Пусто', '', {
        projectId: '',
        team: [{ agentId: 'role_analyst' }],
      }),
    ).toThrow(/проект/i);
    expect(() =>
      board.create('Без команды', '', { projectId, team: [] }),
    ).toThrow(/агентов|процесс/i);
  });

  it('создаёт задачу с процессом вместо ручного выбора агентов', async () => {
    const { board, projectId, store } = await make();
    const workflow = store.read().workflows[0];
    const task = board.create('Из процесса', 'Описание', {
      projectId,
      workflowId: workflow.id,
    });
    expect(task.workflowId).toBe(workflow.id);
    expect(task.workflowName).toBe(workflow.name);
    expect(task.team.length).toBe(workflow.steps.length);
    expect(task.projectLabel).toBe('test-proj');
  });

  it('после перезапуска доводит уже отданную сборку до проверки', async () => {
    const { board, projectId } = await make();
    await moduleRef?.init();
    const task = board.create('Дожать', 'Уже есть план', {
      projectId,
      team: [{ agentId: 'role_architect', mode: 'plan' }],
    });
    board.move(task.id, 'in_progress');
    await settle();
    process.env.SIM_DELAY_MS = '10000';
    board.handToBuild(task.id, 'План, который уже отдан в сборку.');
    expect(board.get(task.id).phase).toBe('build');
    await moduleRef?.get(StoreService).whenSaved();
    await moduleRef?.close();
    moduleRef = undefined;
    process.env.SIM_DELAY_MS = '0';

    const next = await make(join(directory, 'state.json'));
    await moduleRef?.init();
    await settle();
    expect(next.board.get(task.id).status).toBe('review');
    expect(next.board.get(task.id).phase).toBe('done');
  });
});
