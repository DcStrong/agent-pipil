import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../configure-app';
import { MACHINE_RUNS_TEXT } from '../runtime/cursor-files';
import { ProjectCursorModule } from './project-cursor.module';

describe('Проект Cursor (HTTP)', () => {
  let app: INestApplication<App>;
  let root = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProjectCursorModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pipil-http-'));
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('три списка читаются и пишутся по пути проекта, рекомендация сама не включается', async () => {
    const server = app.getHttpServer();
    const fetchMock = jest.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const listed = await request(server)
        .get('/api/project/cursor')
        .query({ folder: root })
        .expect(200);
      expect(listed.body.cursorApi).toBe('disconnected');
      expect(listed.body.rules).toEqual([]);
      expect(listed.body.skills).toEqual([]);
      expect(listed.body.mcp).toEqual([]);
      expect(listed.body.recommendation.added).toBe(false);
      expect(listed.body.recommendation.text).toBe(MACHINE_RUNS_TEXT);

      await request(server)
        .put('/api/project/cursor/file')
        .send({
          folder: root,
          kind: 'rule',
          name: 'модуль',
          content: 'правило\n',
        })
        .expect(200);
      await request(server)
        .put('/api/project/cursor/file')
        .send({ folder: root, kind: 'skill', name: 'сбор', content: 'навык\n' })
        .expect(200);
      await request(server)
        .put('/api/project/cursor/file')
        .send({
          folder: root,
          kind: 'mcp',
          name: 'локально',
          content: '{ "command": "pwd" }',
        })
        .expect(200);

      const saved = await request(server)
        .get('/api/project/cursor')
        .query({ folder: root })
        .expect(200);
      expect(saved.body.rules).toEqual([
        {
          kind: 'rule',
          name: 'модуль.mdc',
          relativePath: '.cursor/rules/модуль.mdc',
        },
      ]);
      expect(saved.body.skills).toEqual([
        {
          kind: 'skill',
          name: 'сбор',
          relativePath: '.cursor/skills/сбор/SKILL.md',
        },
      ]);
      expect(saved.body.mcp).toEqual([
        { kind: 'mcp', name: 'локально', relativePath: '.cursor/mcp.json' },
      ]);
      expect(saved.body.recommendation.added).toBe(false);

      const opened = await request(server)
        .get('/api/project/cursor/file')
        .query({
          folder: root,
          kind: 'rule',
          name: 'модуль.mdc',
          path: '.cursor/rules/модуль.mdc',
        })
        .expect(200);
      expect(opened.body.content).toBe('правило\n');

      const added = await request(server)
        .post('/api/project/cursor/recommendation')
        .send({ folder: root })
        .expect(201);
      expect(added.body.added).toBe(true);
      expect(added.body.relativePath).toBe(
        '.cursor/rules/запуски-на-машине.mdc',
      );
      const file = readFileSync(
        join(root, '.cursor', 'rules', 'запуски-на-машине.mdc'),
        'utf8',
      );
      expect(file).toContain(MACHINE_RUNS_TEXT);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
