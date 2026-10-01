import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CursorFilesError,
  listCursorProject,
  readCursorFile,
  saveCursorFile,
  writeRecommendation,
  MACHINE_RUNS_TEXT,
} from './cursor-files';

function project(): string {
  return mkdtempSync(join(tmpdir(), 'pipil-cursor-'));
}

describe('файлы .cursor', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function make(): string {
    const root = project();
    roots.push(root);
    return root;
  }

  it('читает и сохраняет правила, навыки и MCP, не вызывая сеть', () => {
    const root = make();
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    mkdirSync(join(root, '.cursor', 'skills', 'обзор'), { recursive: true });
    writeFileSync(
      join(root, '.cursor', 'rules', 'стиль.mdc'),
      'держи стиль',
      'utf8',
    );
    writeFileSync(
      join(root, '.cursor', 'skills', 'обзор', 'SKILL.md'),
      'как смотреть код',
      'utf8',
    );
    writeFileSync(
      join(root, '.cursor', 'mcp.json'),
      JSON.stringify({
        note: 'оставить',
        mcpServers: { поиск: { command: 'echo' } },
      }),
      'utf8',
    );

    const fetchMock = jest.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    const previousLive = process.env.CURSOR_LIVE;
    process.env.CURSOR_LIVE = '1';
    try {
      const view = listCursorProject(root);
      expect(view.cursorApi).toBe('disconnected');
      expect(view.available).toBe(true);
      expect(view.rules.map((item) => item.relativePath)).toEqual([
        '.cursor/rules/стиль.mdc',
      ]);
      expect(view.skills.map((item) => item.name)).toEqual(['обзор']);
      expect(view.mcp.map((item) => item.name)).toEqual(['поиск']);
      expect(view.recommendation.added).toBe(false);
      expect(
        existsSync(join(root, '.cursor', 'rules', 'запуски-на-машине.mdc')),
      ).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();

      const rule = saveCursorFile({
        folder: root,
        kind: 'rule',
        name: 'границы',
        content: 'не выходить за модуль\n',
      });
      const skill = saveCursorFile({
        folder: root,
        kind: 'skill',
        name: 'проверка',
        content: 'сначала тест\n',
      });
      const mcp = saveCursorFile({
        folder: root,
        kind: 'mcp',
        name: 'диск',
        content: '{ "command": "ls" }\n',
      });
      expect(readCursorFile({ folder: root, ...rule }).content).toBe(
        'не выходить за модуль\n',
      );
      expect(readCursorFile({ folder: root, ...skill }).content).toBe(
        'сначала тест\n',
      );
      expect(readCursorFile({ folder: root, ...mcp }).content).toContain(
        '"command": "ls"',
      );

      const again = listCursorProject(root);
      expect(again.rules.map((item) => item.name).sort()).toEqual([
        'границы.mdc',
        'стиль.mdc',
      ]);
      expect(again.skills.map((item) => item.name).sort()).toEqual([
        'обзор',
        'проверка',
      ]);
      expect(again.mcp.map((item) => item.name).sort()).toEqual([
        'диск',
        'поиск',
      ]);
      const raw = readFileSync(join(root, '.cursor', 'mcp.json'), 'utf8');
      expect(raw).toContain('"note": "оставить"');
      expect(again.recommendation.added).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
      if (previousLive === undefined) delete process.env.CURSOR_LIVE;
      else process.env.CURSOR_LIVE = previousLive;
    }
  });

  it('оставляет рекомендацию выключенной, пока её явно не запишут', () => {
    const root = make();
    const before = listCursorProject(root);
    expect(before.recommendation.added).toBe(false);
    expect(before.recommendation.text).toBe(MACHINE_RUNS_TEXT);
    expect(before.recommendation.relativePath).toBe(
      '.cursor/rules/запуски-на-машине.mdc',
    );
    expect(existsSync(join(root, '.cursor'))).toBe(false);

    const written = writeRecommendation(root);
    expect(written.added).toBe(true);
    const body = readFileSync(
      join(root, '.cursor', 'rules', 'запуски-на-машине.mdc'),
      'utf8',
    );
    expect(body).toContain(MACHINE_RUNS_TEXT);
    expect(body).toContain('alwaysApply: true');

    const custom = body.replace(MACHINE_RUNS_TEXT, 'своя правка');
    writeFileSync(
      join(root, '.cursor', 'rules', 'запуски-на-машине.mdc'),
      custom,
      'utf8',
    );
    expect(writeRecommendation(root).added).toBe(true);
    expect(
      readFileSync(
        join(root, '.cursor', 'rules', 'запуски-на-машине.mdc'),
        'utf8',
      ),
    ).toBe(custom);

    const after = listCursorProject(root);
    expect(after.recommendation.added).toBe(true);
    expect(
      after.rules.some((item) =>
        item.relativePath.endsWith('запуски-на-машине.mdc'),
      ),
    ).toBe(true);
  });

  it('не пишет файл за пределы .cursor', () => {
    const root = make();
    const outside = mkdtempSync(join(tmpdir(), 'pipil-outside-'));
    roots.push(outside);
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    symlinkSync(outside, join(root, '.cursor', 'rules', 'наружу'));

    expect(() =>
      saveCursorFile({
        folder: root,
        kind: 'rule',
        name: 'x',
        content: 'чужое',
        relativePath: '.cursor/rules/../../secret.mdc',
      }),
    ).toThrow(CursorFilesError);
    expect(() =>
      saveCursorFile({
        folder: root,
        kind: 'rule',
        name: '../secret',
        content: 'чужое',
      }),
    ).toThrow(CursorFilesError);
    expect(() =>
      saveCursorFile({
        folder: root,
        kind: 'rule',
        name: 'evil',
        content: 'чужое',
        relativePath: '.cursor/rules/наружу/evil.mdc',
      }),
    ).toThrow(CursorFilesError);

    expect(existsSync(join(root, 'secret.mdc'))).toBe(false);
    expect(existsSync(join(outside, 'evil.mdc'))).toBe(false);
  });

  it('не затирает уже существующий файл при добавлении и чинит битый mcp.json', () => {
    const root = make();
    saveCursorFile({
      folder: root,
      kind: 'rule',
      name: 'одно',
      content: 'первый',
    });
    expect(() =>
      saveCursorFile({
        folder: root,
        kind: 'rule',
        name: 'одно',
        content: 'второй',
      }),
    ).toThrow(/уже есть/);
    const kept = saveCursorFile({
      folder: root,
      kind: 'rule',
      name: 'одно.mdc',
      content: 'правка',
      relativePath: '.cursor/rules/одно.mdc',
    });
    expect(kept.content).toBe('правка');

    writeFileSync(join(root, '.cursor', 'mcp.json'), '{', 'utf8');
    expect(listCursorProject(root).mcp.map((item) => item.name)).toEqual([
      'mcp.json',
    ]);
    saveCursorFile({
      folder: root,
      kind: 'mcp',
      name: 'mcp.json',
      content: '{ "mcpServers": { "локально": { "command": "true" } } }',
    });
    expect(listCursorProject(root).mcp.map((item) => item.name)).toEqual([
      'локально',
    ]);
  });

  it('для неизвестной папки отдаёт пустой список и не создаёт .cursor', () => {
    const missing = join(tmpdir(), 'pipil-net-folder-missing');
    const view = listCursorProject(missing);
    expect(view.available).toBe(false);
    expect(view.cursorApi).toBe('disconnected');
    expect(view.recommendation.added).toBe(false);
    expect(existsSync(missing)).toBe(false);
    expect(() => writeRecommendation(missing)).toThrow(/не найдена/);
  });
});
