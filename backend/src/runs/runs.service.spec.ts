import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { WorkflowsService } from '../workflows/workflows.service';
import { setCliAuthExecForTests } from '../runtime/cursor-cli-auth';
import { setCursorCliExecForTests } from '../runtime/cursor-cli';
import { RunsService } from './runs.service';

function installCursorFetchMock(): () => void {
  const original = globalThis.fetch;
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/agents') && init?.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          agent: { id: 'bc-mock-agent', url: 'https://cursor.com/agents/bc-mock-agent' },
          run: { id: 'run-mock-1' },
        }),
      } as Response;
    }
    if (url.includes('/runs/run-mock-1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'FINISHED',
          result: 'Ответ Cloud Agent для теста.',
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
  let restoreFetch: (() => void) | undefined;

  beforeAll(() => {
    process.env.SIM_DELAY_MS = '0';
    delete process.env.CURSOR_LIVE;
    delete process.env.CURSOR_API_TOKEN;
    restoreFetch = installCursorFetchMock();
  });

  afterAll(() => {
    restoreFetch?.();
    if (previousDelay === undefined) delete process.env.SIM_DELAY_MS;
    else process.env.SIM_DELAY_MS = previousDelay;
    if (previousLive === undefined) delete process.env.CURSOR_LIVE;
    else process.env.CURSOR_LIVE = previousLive;
    if (previousToken === undefined) delete process.env.CURSOR_API_TOKEN;
    else process.env.CURSOR_API_TOKEN = previousToken;
  });

  afterEach(async () => {
    setCliAuthExecForTests(null);
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
        folderName: 'run-proj',
        alias: '',
      });
    });
    return id;
  }

  async function make(options?: { token?: boolean }): Promise<{
    runs: RunsService;
    settings: SettingsService;
    workflows: WorkflowsService;
    projectId: string;
  }> {
    directory = await mkdtemp(join(tmpdir(), 'pipil-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        RunsService,
        ProjectsService,
        WorkflowsService,
        SettingsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
      ],
    }).compile();
    const settings = moduleRef.get(SettingsService);
    const store = moduleRef.get(StoreService);
    const projectId = seedProject(store, directory);
    settings.setMode('api');
    if (options?.token !== false) {
      settings.save('cursor_test_token_value');
    }
    return {
      runs: moduleRef.get(RunsService),
      settings,
      workflows: moduleRef.get(WorkflowsService),
      projectId,
    };
  }

  it('останавливается на проверке и после подтверждения отдаёт итог', async () => {
    const { runs, projectId } = await make();
    const started = runs.start(
      'workflow_supervised',
      'Добавить тихий режим уведомлений',
      { projectId },
    );
    expect(started.status).toBe('running');
    expect(started.stepIndex).toBe(0);
    expect(() =>
      runs.start('workflow_supervised', 'Вторая задача', { projectId }),
    ).toThrow(ConflictException);

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
    const { runs, projectId } = await make();
    const started = runs.start('workflow_supervised', 'Короткий запуск', {
      projectId,
    });
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

  it('отказ от вопроса завершает запуск и не считает шагов больше, чем их есть', async () => {
    const { runs } = await make();
    const started = runs.start(
      'workflow_supervised',
      'Нужен массив объектов заказов',
      {
        roleIds: ['role_architect', 'role_developer', 'role_tester'],
      },
    );
    const waiting = await until(runs, started.id, 'waiting_user');
    expect(waiting.status).toBe('waiting_user');
    expect(waiting.pendingQuestion).toContain('массив');
    expect(waiting.work.length).toBeLessThanOrEqual(waiting.steps.length);

    const rejected = runs.decide(started.id, false);
    expect(rejected.status).toBe('failed');
    expect(rejected.error).toContain('отклонил вопрос');
    expect(rejected.pendingQuestion).toBeNull();
    expect(rejected.finishedAt).toBeTruthy();
    expect(rejected.work.length).toBeLessThanOrEqual(rejected.steps.length);

    await settle();
    const finished = runs.get(started.id);
    expect(finished.status).toBe('failed');
    expect(finished.work.length).toBeLessThanOrEqual(finished.steps.length);
    const known = new Set(finished.steps.map((step) => step.stepId));
    const seen = new Set(
      finished.work
        .map((item) => item.stepId)
        .filter((id) => known.has(id)),
    );
    expect(seen.size).toBeLessThanOrEqual(finished.steps.length);
    expect(runs.list().some((run) => run.id === started.id && run.status === 'waiting_user')).toBe(
      false,
    );
  });

  it('остановка незавершённого запуска снимает блокировку процесса', async () => {
    const { runs } = await make();
    const started = runs.start(
      'workflow_supervised',
      'Нужен массив объектов заказов',
      { roleIds: ['role_architect'] },
    );
    await until(runs, started.id, 'waiting_user');
    const stopped = runs.stop(started.id);
    expect(stopped.status).toBe('failed');
    expect(stopped.error).toContain('остановлен');
    await settle();
    const finished = runs.get(started.id);
    expect(finished.status).toBe('failed');
    expect(finished.work.length).toBeLessThanOrEqual(finished.steps.length);
    expect(() => runs.stop(started.id)).toThrow('уже закончен');
  });

  it('повтор неуспешного запуска продолжает с шага обрыва', async () => {
    const { runs } = await make();
    const started = runs.start(
      'workflow_supervised',
      'Нужен массив объектов заказов',
      { roleIds: ['role_architect', 'role_developer'] },
    );
    await until(runs, started.id, 'waiting_user');
    const stopped = runs.stop(started.id);
    expect(stopped.status).toBe('failed');
    await settle();
    const workBefore = stopped.work.length;
    const retried = runs.retry(started.id);
    expect(retried.status).toBe('running');
    expect(retried.error).toBeNull();
    const waitingAgain = await until(runs, retried.id, 'waiting_user');
    expect(waitingAgain.status).toBe('waiting_user');
    runs.answer(retried.id, 'Массив объектов');
    const done = await until(runs, retried.id, 'completed');
    expect(done.status).toBe('completed');
    expect(done.work.length).toBeGreaterThanOrEqual(workBefore);
  });

  it('повтор после ошибки CLI сохраняет готовые шаги и показывает stderr', async () => {
    let calls = 0;
    setCursorCliExecForTests(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          stdout: '',
          stderr: 'Workspace Trust Required: pass --trust',
          code: 1,
        };
      }
      return {
        stdout: 'run-deadbeef\nОтвет после повтора.',
        stderr: '',
        code: 0,
      };
    });
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'status') {
        return {
          stdout: JSON.stringify({ authenticated: true, email: 'dev@example.com' }),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const previousBin = process.env.CURSOR_AGENT_BIN;
    try {
      const { runs, projectId, settings } = await make({ token: false });
      const fakeAgent = join(directory, 'fake-agent');
      await writeFile(fakeAgent, '#!/bin/sh\n');
      await chmod(fakeAgent, 0o755);
      process.env.CURSOR_AGENT_BIN = fakeAgent;
      settings.setMode('cli');
      const started = runs.start('workflow_supervised', 'CLI retry', {
        roleIds: ['agent_builder'],
        projectId,
      });
      const failed = await until(runs, started.id, 'failed');
      expect(failed.error).toContain('Trust');
      expect(failed.steps[0]?.messages.some((m) => m.text.includes('Trust'))).toBe(
        true,
      );
      const retried = runs.retry(failed.id);
      expect(retried.status).toBe('running');
      const done = await until(runs, retried.id, 'completed');
      expect(done.work.some((item) => item.output.includes('повтора'))).toBe(true);
      expect(calls).toBe(2);
    } finally {
      setCliAuthExecForTests(null);
      setCursorCliExecForTests(null);
      if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
      else process.env.CURSOR_AGENT_BIN = previousBin;
    }
  });

  it('не стартует со средой Cursor без projectId', async () => {
    const { runs, settings } = await make();
    settings.save('cursor_test_token_value');
    expect(() =>
      runs.start('workflow_supervised', 'Задача без проекта', {
        roleIds: ['agent_builder'],
      }),
    ).toThrow(/проект|workspace/i);
  });

  it('шаг Cursor без токена завершается ошибкой на русском', async () => {
    const { runs, projectId } = await make({ token: false });
    const started = runs.start('workflow_supervised', 'Проверка Cursor', {
      roleIds: ['agent_builder'],
      projectId,
    });
    const failed = await until(runs, started.id, 'failed');
    expect(failed.error).toContain('токен');
  });

  it('сохраняет токен Cursor и не возвращает его целиком', async () => {
    const { settings } = await make();
    const secret = 'cursor_live_token_value';
    const saved = settings.save(secret);
    expect(saved).toEqual(
      expect.objectContaining({
        connected: true,
        source: 'saved',
        hint: '••••alue',
        mode: 'api',
      }),
    );
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(settings.clear()).toEqual(
      expect.objectContaining({
        connected: false,
        source: 'none',
        hint: null,
        mode: 'api',
      }),
    );
  });

  it('сохраняет ключ CLI и не возвращает его целиком', async () => {
    const { settings } = await make({ token: false });
    settings.setMode('cli');
    const secret = 'cursor_cli_key_value';
    const saved = settings.saveCliApiKey(secret);
    expect(saved).toEqual(
      expect.objectContaining({
        connected: false,
        source: 'saved',
        hint: '••••alue',
        mode: 'cli',
      }),
    );
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(settings.clear()).toEqual(
      expect.objectContaining({
        connected: false,
        source: 'none',
        hint: null,
        mode: 'cli',
      }),
    );
  });

  it('в режиме CLI с сессией без сохранённого ключа выполняет шаг', async () => {
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'status') {
        return {
          stdout: JSON.stringify({ authenticated: true, email: 'dev@example.com' }),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    setCursorCliExecForTests(async () => ({
      stdout: 'Ответ локального CLI по сессии.',
      stderr: '',
      code: 0,
    }));
    const previousBin = process.env.CURSOR_AGENT_BIN;
    try {
      const { runs, projectId, settings } = await make({ token: false });
      const fakeAgent = join(directory, 'fake-agent');
      await writeFile(fakeAgent, '#!/bin/sh\n');
      await chmod(fakeAgent, 0o755);
      process.env.CURSOR_AGENT_BIN = fakeAgent;
      settings.setMode('cli');
      const started = runs.start('workflow_supervised', 'Проверка CLI сессии', {
        roleIds: ['agent_builder'],
        projectId,
      });
      const done = await until(runs, started.id, 'completed');
      expect(done.status).toBe('completed');
      expect(done.work.some((item) => item.output.includes('сессии'))).toBe(true);
    } finally {
      setCliAuthExecForTests(null);
      setCursorCliExecForTests(null);
      if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
      else process.env.CURSOR_AGENT_BIN = previousBin;
    }
  });

  it('в режиме CLI вызывает подменённый agent без сети', async () => {
    setCursorCliExecForTests(async () => ({
      stdout: 'Ответ локального CLI.',
      stderr: '',
      code: 0,
    }));
    const previousBin = process.env.CURSOR_AGENT_BIN;
    try {
      const { runs, projectId, settings } = await make({ token: false });
      const fakeAgent = join(directory, 'fake-agent');
      await writeFile(fakeAgent, '#!/bin/sh\n');
      await chmod(fakeAgent, 0o755);
      process.env.CURSOR_AGENT_BIN = fakeAgent;
      settings.setMode('cli');
      settings.saveCliApiKey('cursor_cli_run_test_key');
      const started = runs.start('workflow_supervised', 'Проверка CLI', {
        roleIds: ['agent_builder'],
        projectId,
      });
      const done = await until(runs, started.id, 'completed');
      expect(done.status).toBe('completed');
      expect(done.work.some((item) => item.output.includes('локального CLI'))).toBe(true);
    } finally {
      setCursorCliExecForTests(null);
      if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
      else process.env.CURSOR_AGENT_BIN = previousBin;
    }
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
    const known = new Set(done.steps.map((step) => step.stepId));
    const seen = new Set(
      done.work.filter((item) => known.has(item.stepId)).map((item) => item.stepId),
    );
    expect(seen.size).toBeLessThanOrEqual(done.steps.length);
    expect(seen.size).toBeLessThan(done.work.length);
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
    const { runs, workflows, projectId } = await make();
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
    const started = runs.start('workflow_supervised', 'Короткий обход дерева', {
      projectId,
    });
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
    const { runs, workflows, projectId } = await make();
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
      { projectId },
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
    const { runs, workflows, projectId } = await make();
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
        projectId,
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

  it('пресет «Вопрос» отвечает на текст задачи, а не на обзор диска', async () => {
    const { runs, workflows, projectId } = await make();
    workflows.replace('workflow_supervised', 'Вопрос', 'Один шаг', [
      {
        id: 'q',
        agentId: 'role_orchestrator',
        title: 'Вопрос',
        mode: 'question',
        handoff: '',
        nextIds: [],
      },
    ]);
    const started = runs.start('workflow_supervised', 'Вопрос\n\nпривет', {
      projectId,
    });
    const done = await until(runs, started.id, 'completed');
    expect(done.status).toBe('completed');
    const step = done.steps[0];
    expect(step?.messages.some((item) => item.author === 'user' && item.text.includes('привет'))).toBe(
      true,
    );
    const roleText = step?.messages
      .filter((item) => item.author === 'role')
      .map((item) => item.text)
      .join('\n');
    expect(roleText).toContain('привет');
    expect(roleText).toContain('имитация');
    expect(roleText).not.toContain('Новый диалог этой задачи');
    expect(roleText).not.toContain('.DS_Store');
    expect(done.finalResult).toContain('привет');
    expect(done.finalResult).not.toContain('Сам посмотрел проект');
  });
});
