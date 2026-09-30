import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(saved.body).toEqual({
      connected: true,
      source: 'saved',
      hint: '••••oken',
    });
    expect(JSON.stringify(saved.body)).not.toContain(secret);

    await request(server).delete('/api/settings/cursor').expect(200);

    const started = (
      await request(server)
        .post('/api/runs')
        .send({ workflowId: workflow?.id, task: 'Добавить экспорт в webp' })
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
});
