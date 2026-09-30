import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import type { Role, Run, Skill } from '../src/domain';

process.env.DATA_PATH = join(
  mkdtempSync(join(tmpdir(), 'pipil-e2e-')),
  'state.json',
);
process.env.SIM_DELAY_MS = '0';
process.env.AGENT_MODE = 'simulated';
delete process.env.MODEL_API_KEY;

describe('Pipeline API (e2e)', () => {
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

  it('reports a simulated agent and the seeded roles', async () => {
    const health = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(health.body).toEqual({ ok: true, agentMode: 'simulated' });

    const roles = await request(app.getHttpServer())
      .get('/api/roles')
      .expect(200);
    const names = (roles.body as Role[]).map((role) => role.name);
    expect(names).toEqual(['Analyst', 'Architect', 'Developer', 'Reviewer']);
  });

  it('edits a prompt, adds both kinds of skill, and runs the task to a result', async () => {
    const server = app.getHttpServer();
    const roles = (await request(server).get('/api/roles')).body as Role[];
    const analyst = roles.find((role) => role.name === 'Analyst');
    expect(analyst).toBeDefined();

    await request(server)
      .put(`/api/roles/${analyst?.id}`)
      .send({
        name: 'Analyst',
        systemPrompt: 'You are the analyst. Start from the user task.',
      })
      .expect(200);

    const shared = (
      await request(server).post('/api/skills').send({
        name: 'Plain language',
        instructions: 'Write so the next person can continue.',
        scope: 'shared',
      })
    ).body as Skill;
    expect(shared.scope).toBe('shared');

    const owned = (
      await request(server).post('/api/skills').send({
        name: 'Reset checklist',
        instructions: 'Mention the reset path.',
        scope: 'role',
        roleId: analyst?.id,
      })
    ).body as Skill;
    expect(owned.roleId).toBe(analyst?.id);

    await request(server).post('/api/runs').send({ task: '   ' }).expect(400);

    const started = (
      await request(server)
        .post('/api/runs')
        .send({ task: 'Add a password reset flow' })
        .expect(201)
    ).body as Run;
    expect(started.status).toBe('running');
    expect(started.ownerName).toBe('Analyst');

    let finished = started;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = (await request(server).get(`/api/runs/${started.id}`))
        .body as Run;
      finished = current;
      if (current.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(finished.status).toBe('completed');
    expect(finished.finalResult).toContain('Add a password reset flow');
    expect(finished.work.map((item) => item.roleName)).toEqual([
      'Analyst',
      'Architect',
      'Developer',
      'Reviewer',
    ]);
    expect(finished.stages[0]?.systemPrompt).toContain(
      'Start from the user task',
    );
    expect(finished.stages[0]?.skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(['Plain language', 'Reset checklist']),
    );
    expect(finished.stages[2]?.skills.map((skill) => skill.name)).not.toContain(
      'Reset checklist',
    );

    await request(server).delete(`/api/roles/${analyst?.id}`).expect(400);
  });

  it('streams the current run to a new subscriber', async () => {
    const url = await app.getUrl();
    const response = await fetch(`${url}/api/runs/events`);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let text = '';
    while (reader && !text.includes('data:')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain('"type":"run"');
    await reader?.cancel();
  });
});
