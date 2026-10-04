import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import type { Run, Workflow } from '../src/domain';

process.env.DATA_PATH = join(
  mkdtempSync(join(tmpdir(), 'pipil-e2e-')),
  'state.json',
);
process.env.SIM_DELAY_MS = '0';
delete process.env.CURSOR_API_TOKEN;
delete process.env.CURSOR_LIVE;

function installCursorFetchMock(): void {
  const original = globalThis.fetch;
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/v1/agents') && init?.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          agent: { id: 'bc-e2e-agent', url: 'https://cursor.com/agents/bc-e2e-agent' },
          run: { id: 'run-e2e-1' },
        }),
      } as Response;
    }
    if (url.includes('/runs/run-e2e-1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'FINISHED',
          result: 'E2E: шаг Cursor выполнен.',
        }),
      } as Response;
    }
    if (original) return original(url, init);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

installCursorFetchMock();

describe('Оркестратор (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    await request(app.getHttpServer())
      .patch('/api/settings/cursor/mode')
      .send({ mode: 'api' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('открывается без токена, ставит паузу на проверке и не отдаёт секрет', async () => {
    const server = app.getHttpServer();
    const health = await request(server).get('/api/health').expect(200);
    expect(health.body).toEqual({ ok: true, cursorConnected: false });

    const workflows = (await request(server).get('/api/workflows').expect(200))
      .body as Workflow[];
    expect(workflows.map((item) => item.name)).toContain('Сборка с проверкой');
    const workflow = workflows[0];
    expect(workflow?.steps.map((step) => step.mode)).toEqual([
      'automatic',
      'automatic',
      'approval',
    ]);

    const secret = 'cursor_secret_token';
    const saved = await request(server)
      .put('/api/settings/cursor')
      .send({ token: secret })
      .expect(200);
    expect(saved.body).toEqual(
      expect.objectContaining({
        connected: true,
        source: 'saved',
        hint: '••••oken',
        mode: 'api',
      }),
    );
    expect(JSON.stringify(saved.body)).not.toContain(secret);

    await request(server).delete('/api/settings/cursor').expect(200);

    await request(server)
      .put('/api/settings/cursor')
      .send({ token: secret })
      .expect(200);

    const project = await request(server)
      .post('/api/projects')
      .send({ kind: 'folder', path: dirname(process.env.DATA_PATH!) })
      .expect(201);
    const projectId = project.body.id as string;

    const started = (
      await request(server)
        .post('/api/runs')
        .send({
          workflowId: workflow?.id,
          task: 'Добавить экспорт в webp',
          projectId,
        })
        .expect(201)
    ).body as Run;

    let current = started;
    for (
      let attempt = 0;
      attempt < 40 && current.status === 'running';
      attempt += 1
    ) {
      current = (await request(server).get(`/api/runs/${started.id}`))
        .body as Run;
      if (current.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(current.status).toBe('waiting_approval');

    await request(server)
      .post(`/api/runs/${started.id}/decision`)
      .send({ decision: 'approve' })
      .expect(201);

    for (
      let attempt = 0;
      attempt < 40 && current.status !== 'completed';
      attempt += 1
    ) {
      current = (await request(server).get(`/api/runs/${started.id}`))
        .body as Run;
      if (current.status === 'completed' || current.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(current.status).toBe('completed');
    expect(current.finalResult).toContain('Добавить экспорт в webp');
  });

  it('ведёт задачи доски из новых через план в проверку и не зовёт Cursor', async () => {
    const server = app.getHttpServer();
    const secret = 'cursor_live_must_not_run';
    await request(server)
      .put('/api/settings/cursor')
      .send({ token: secret })
      .expect(200);

    const listed = await request(server).get('/api/projects').expect(200);
    let projectId = (listed.body as Array<{ id: string }>)[0]?.id;
    if (!projectId) {
      const project = await request(server)
        .post('/api/projects')
        .send({ kind: 'folder', path: dirname(process.env.DATA_PATH!) })
        .expect(201);
      projectId = project.body.id as string;
    }

    const created = await request(server)
      .post('/api/board')
      .send({
        title: 'Доска',
        description: 'Нужен план до сборки',
        projectId,
        team: [{ agentId: 'role_analyst', mode: 'ask' }],
      })
      .expect(201);
    const asked = await request(server)
      .post('/api/board')
      .send({
        title: 'Только вопрос',
        projectId,
        team: [{ agentId: 'role_analyst', mode: 'ask' }],
      })
      .expect(201);
    expect(created.body.status).toBe('new');
    expect(asked.body.status).toBe('new');

    const moved = await request(server)
      .post(`/api/board/${created.body.id}/move`)
      .send({ status: 'in_progress' })
      .expect(201);
    expect(moved.body.status).toBe('in_progress');
    expect(moved.body.activity[0].note).toContain('Взял задачу');
    expect(moved.body.runId).toBeTruthy();
    const pipeline = await request(server)
      .get(`/api/runs/${moved.body.runId as string}`)
      .expect(200);
    expect(pipeline.body.project?.folder).toBeTruthy();
    expect(JSON.stringify(moved.body)).not.toContain(secret);

    await request(server)
      .post(`/api/board/${created.body.id}/move`)
      .send({ status: 'review' })
      .expect(400);

    let current = moved.body as {
      status: string;
      phase: string;
      plan: { text: string } | null;
    };
    for (
      let attempt = 0;
      attempt < 40 && current.status !== 'review';
      attempt += 1
    ) {
      current = (await request(server).get(`/api/board/${created.body.id}`))
        .body;
      if (current.status === 'review') break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(current.status).toBe('review');
    expect(current.phase).toBe('done');
    expect(current.plan).toBeNull();

    await request(server)
      .post(`/api/board/${asked.body.id}/move`)
      .send({ status: 'in_progress' })
      .expect(201);
    let question = asked.body as { status: string; plan: unknown };
    for (
      let attempt = 0;
      attempt < 40 && question.status !== 'review';
      attempt += 1
    ) {
      question = (await request(server).get(`/api/board/${asked.body.id}`))
        .body;
      if (question.status === 'review') break;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(question.status).toBe('review');
    expect(question.plan).toBeNull();
  });
});
