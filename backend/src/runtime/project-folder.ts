/**
 * Папка проекта: карта, тесты и пути из .cursor.
 * Содержимое правил, навыков и команд в диалоги не копируется.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { emptyProject, type ProjectSnapshot } from '../domain';

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.pipil']);
const MAX_ENTRIES = 80;
const MAX_MAP = 12_000;

function safeDir(folder: string): string | null {
  const trimmed = folder.trim();
  if (!trimmed || trimmed.length > 300) return null;
  const full = resolve(trimmed);
  try {
    if (!statSync(full).isDirectory()) return null;
  } catch {
    return null;
  }
  if (full === sep || full === '/') return null;
  return full;
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
}

function walk(
  root: string,
  dir: string,
  depth: number,
  visit: (relativePath: string, isDir: boolean) => void,
  budget: { left: number },
): void {
  if (depth < 0 || budget.left <= 0) return;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (budget.left <= 0) return;
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    const rel = relative(root, full).split(sep).join('/');
    budget.left -= 1;
    visit(rel, isDir);
    if (isDir) walk(root, full, depth - 1, visit, budget);
  }
}

function listCursor(root: string, folderName: string): string[] {
  const base = join(root, '.cursor', folderName);
  const found: string[] = [];
  walk(root, base, 2, (rel, isDir) => {
    if (!isDir) found.push(rel);
  }, { left: 40 });
  return found;
}

function listTests(root: string): string[] {
  const found: string[] = [];
  walk(
    root,
    root,
    3,
    (rel, isDir) => {
      if (isDir) return;
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('посторонн')) {
        found.push(rel);
      }
    },
    { left: MAX_ENTRIES },
  );
  return found;
}

function listSurvey(root: string): string[] {
  const found: string[] = [];
  walk(
    root,
    root,
    1,
    (rel) => {
      found.push(rel);
    },
    { left: 40 },
  );
  return found;
}

function readMap(path: string): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_MAP) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Собирает пути. Тексты файлов .cursor здесь не читаются. */
export function inspectProject(
  folder: string | null,
  mapPath: string | null,
): ProjectSnapshot {
  const snapshot = emptyProject();
  if (!folder || !folder.trim()) return snapshot;
  const root = safeDir(folder);
  if (!root) {
    snapshot.folder = folder.trim();
    return snapshot;
  }
  snapshot.folder = root;
  snapshot.available = true;
  snapshot.rules = listCursor(root, 'rules');
  snapshot.skills = listCursor(root, 'skills');
  snapshot.commands = listCursor(root, 'commands');
  snapshot.tests = listTests(root);
  const pointed = Boolean(mapPath && mapPath.trim());
  snapshot.pointedAtMap = pointed;
  const chosen = pointed
    ? resolve(root, mapPath!.trim())
    : join(root, '.pipil', 'карта.md');
  if (!inside(root, chosen)) {
    snapshot.mapMissing = true;
    return snapshot;
  }
  snapshot.mapPath = chosen;
  const body = readMap(chosen);
  snapshot.mapText = body;
  snapshot.mapMissing = body === null;
  if (snapshot.mapMissing && !pointed) {
    snapshot.surveyed = true;
    snapshot.survey = listSurvey(root);
  }
  return snapshot;
}

function compose(current: string | null, additions: string[]): string {
  const lines = additions.map((item) => item.trim()).filter(Boolean);
  const base = (current ?? '').trim();
  const fresh = lines.filter((line) => !base.includes(line));
  if (fresh.length === 0) return base;
  const block = ['## Заметки ролей', ...fresh.map((line) => `- ${line}`)].join('\n');
  if (!base) {
    return ['# Карта', '', '## Модули', '', '## Связи', '', '## Владение', '', '## Документы', '', block, ''].join('\n');
  }
  return `${base}\n\n${block}\n`;
}

/**
 * Пишет карту только если текст реально изменился.
 * Вызывать может только оркестратор в конце задачи.
 */
export function writeProjectMap(
  snapshot: ProjectSnapshot,
  additions: string[],
): { wrote: boolean; body: string | null } {
  const body = compose(snapshot.mapText, additions);
  if (!snapshot.available || !snapshot.folder || !snapshot.mapPath) {
    return { wrote: false, body: additions.length ? body : null };
  }
  if (body.trim() === (snapshot.mapText ?? '').trim()) {
    return { wrote: false, body };
  }
  if (!additions.some((item) => item.trim() && !((snapshot.mapText ?? '').includes(item.trim())))) {
    return { wrote: false, body };
  }
  const target = snapshot.mapPath;
  if (!inside(snapshot.folder, target)) return { wrote: false, body };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, 'utf8');
  return { wrote: true, body };
}
