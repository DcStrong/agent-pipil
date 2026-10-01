/**
 * Файлы среды Cursor в папке проекта: правила, навыки и MCP.
 * Чтение и запись идут только на диск. Сетевой клиент Cursor сюда не подключается.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export type CursorFileKind = 'rule' | 'skill' | 'mcp';

export interface CursorFileItem {
  kind: CursorFileKind;
  name: string;
  relativePath: string;
}

export interface CursorFileDocument extends CursorFileItem {
  content: string;
}

/** Предложение не включается, пока пользователь сам не запишет файл. */
export interface CursorRecommendation {
  id: 'machine-runs';
  title: string;
  text: string;
  relativePath: string;
  added: boolean;
}

export interface CursorProjectView {
  folder: string | null;
  available: boolean;
  /** Живой API не вызывается, даже если в окружении есть токен. */
  cursorApi: 'disconnected';
  rules: CursorFileItem[];
  skills: CursorFileItem[];
  mcp: CursorFileItem[];
  recommendation: CursorRecommendation;
}

export interface SaveCursorFileInput {
  folder: string;
  kind: CursorFileKind;
  name: string;
  content: string;
  /** Пустое значение значит новый файл. Иначе перезаписывается уже открытый путь. */
  relativePath?: string | null;
}

export class CursorFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CursorFilesError';
  }
}

const MAX_TEXT = 200_000;
const MAX_LIST = 200;
/** Имя файла или сервера: буква или цифра, затем буквы, цифры, точка, подчёркивание или дефис. */
const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,64}$/u;
const RULE_REL =
  /^\.cursor\/rules\/(?:[\p{L}\p{N}][\p{L}\p{N}._-]*\/)*[\p{L}\p{N}][\p{L}\p{N}._-]*\.(?:md|mdc|mdx)$/u;
const SKILL_REL =
  /^\.cursor\/skills\/[\p{L}\p{N}][\p{L}\p{N}._-]*\/SKILL\.md$/u;

export const MACHINE_RUNS_PATH = '.cursor/rules/запуски-на-машине.mdc';
export const MACHINE_RUNS_TITLE = 'Запуски на машине пользователя';
export const MACHINE_RUNS_TEXT =
  'Запуски, тесты и логи происходят на машине пользователя, а не внутри агента. Обычный агент их не запускает, пока его не попросят. Тестировщик может их запустить, всё ещё на машине, и в диалог кладёт только вердикт, не лог.';

export function recommendationBody(): string {
  return [
    '---',
    'description: Запуски, тесты и логи остаются на машине пользователя',
    'alwaysApply: true',
    '---',
    '',
    MACHINE_RUNS_TEXT,
    '',
  ].join('\n');
}

export function emptyCursorProject(): CursorProjectView {
  return {
    folder: null,
    available: false,
    cursorApi: 'disconnected',
    rules: [],
    skills: [],
    mcp: [],
    recommendation: recommendationView(false),
  };
}

/** Список трёх групп. Каталог не создаёт файлы и не включает рекомендацию. */
export function listCursorProject(folder: string): CursorProjectView {
  const view = emptyCursorProject();
  const trimmed = folder.trim();
  view.folder = trimmed || null;
  const root = openRoot(trimmed);
  if (!root) return view;
  view.available = true;
  view.folder = root;
  view.rules = listRules(root);
  view.skills = listSkills(root);
  view.mcp = listMcp(root);
  view.recommendation = recommendationView(recommendationAdded(root));
  return view;
}

export function readCursorFile(input: {
  folder: string;
  kind: CursorFileKind;
  name: string;
  relativePath: string;
}): CursorFileDocument {
  const root = requiredRoot(input.folder);
  if (input.kind === 'mcp') return readMcp(root, input.name);
  const rel = normalizeRel(input.relativePath);
  assertKindPath(input.kind, rel);
  return {
    kind: input.kind,
    name: input.kind === 'skill' ? skillName(rel) : fileLabel(root, rel),
    relativePath: rel,
    content: readText(root, rel),
  };
}

/** Пишет один файл в .cursor. Новый файл создаётся только здесь, не при открытии списка. */
export function saveCursorFile(input: SaveCursorFileInput): CursorFileDocument {
  const root = requiredRoot(input.folder);
  const content = textContent(input.content);
  const creating = !input.relativePath?.trim();
  if (input.kind === 'rule') {
    return saveRule(
      root,
      input.name,
      content,
      creating ? null : input.relativePath!.trim(),
    );
  }
  if (input.kind === 'skill') {
    return saveSkill(
      root,
      input.name,
      content,
      creating ? null : input.relativePath!.trim(),
    );
  }
  if (input.kind === 'mcp') return saveMcp(root, input.name, content, creating);
  throw new CursorFilesError('Неизвестная группа файла.');
}

/**
 * Единственная запись рекомендации. Повторный вызов не затирает уже лежащий файл.
 */
export function writeRecommendation(folder: string): CursorRecommendation {
  const root = requiredRoot(folder);
  if (recommendationAdded(root)) return recommendationView(true);
  writeText(root, MACHINE_RUNS_PATH, recommendationBody());
  return recommendationView(true);
}

function recommendationView(added: boolean): CursorRecommendation {
  return {
    id: 'machine-runs',
    title: MACHINE_RUNS_TITLE,
    text: MACHINE_RUNS_TEXT,
    relativePath: MACHINE_RUNS_PATH,
    added,
  };
}

function recommendationAdded(root: string): boolean {
  const target = join(root, '.cursor', 'rules', 'запуски-на-машине.mdc');
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

function listRules(root: string): CursorFileItem[] {
  const base = join(root, '.cursor', 'rules');
  const items: CursorFileItem[] = [];
  walkFiles(base, 6, (full) => {
    if (items.length >= MAX_LIST) return;
    const rel = toPosix(relative(root, full));
    if (!RULE_REL.test(rel)) return;
    items.push({
      kind: 'rule',
      name: toPosix(relative(base, full)),
      relativePath: rel,
    });
  });
  return items.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function listSkills(root: string): CursorFileItem[] {
  const base = join(root, '.cursor', 'skills');
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  const items: CursorFileItem[] = [];
  for (const name of names) {
    if (!SEGMENT.test(name)) continue;
    const rel = `.cursor/skills/${name}/SKILL.md`;
    const full = join(root, '.cursor', 'skills', name, 'SKILL.md');
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    items.push({ kind: 'skill', name, relativePath: rel });
  }
  return items.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

function listMcp(root: string): CursorFileItem[] {
  const doc = loadMcp(root);
  if (!doc.exists) return [];
  if (doc.broken || !doc.value) {
    return [
      { kind: 'mcp', name: 'mcp.json', relativePath: '.cursor/mcp.json' },
    ];
  }
  const servers = readServers(doc.value);
  return Object.keys(servers)
    .sort((left, right) => left.localeCompare(right, 'ru'))
    .map((name) => ({ kind: 'mcp', name, relativePath: '.cursor/mcp.json' }));
}

function saveRule(
  root: string,
  name: string,
  content: string,
  relativePath: string | null,
): CursorFileDocument {
  const rel = relativePath
    ? normalizeRel(relativePath)
    : `.cursor/rules/${ruleFileName(name)}`;
  assertKindPath('rule', rel);
  if (!relativePath && existsFile(join(root, ...rel.split('/')))) {
    throw new CursorFilesError(
      'Такое правило уже есть. Откройте его в списке.',
    );
  }
  writeText(root, rel, content);
  return {
    kind: 'rule',
    name: toPosix(
      relative(join(root, '.cursor', 'rules'), join(root, ...rel.split('/'))),
    ),
    relativePath: rel,
    content,
  };
}

function saveSkill(
  root: string,
  name: string,
  content: string,
  relativePath: string | null,
): CursorFileDocument {
  const rel = relativePath
    ? normalizeRel(relativePath)
    : `.cursor/skills/${skillFolder(name)}/SKILL.md`;
  assertKindPath('skill', rel);
  if (!relativePath && existsFile(join(root, ...rel.split('/')))) {
    throw new CursorFilesError('Такой навык уже есть. Откройте его в списке.');
  }
  writeText(root, rel, content);
  return { kind: 'skill', name: skillName(rel), relativePath: rel, content };
}

function saveMcp(
  root: string,
  name: string,
  content: string,
  creating: boolean,
): CursorFileDocument {
  const serverName = name.trim();
  if (serverName === 'mcp.json') return saveWholeMcp(root, content);
  if (!SEGMENT.test(serverName))
    throw new CursorFilesError('Имя сервера MCP не подходит.');
  const parsed = parseJson(content, 'Нужен JSON одного сервера MCP.');
  const doc = loadMcp(root);
  if (doc.broken) {
    throw new CursorFilesError(
      'Конфигурация MCP повреждена. Откройте mcp.json и поправьте JSON.',
    );
  }
  const base: Record<string, unknown> = doc.value ? { ...doc.value } : {};
  const servers = readServers(base);
  if (creating && Object.prototype.hasOwnProperty.call(servers, serverName)) {
    throw new CursorFilesError('Такой сервер MCP уже есть.');
  }
  servers[serverName] = parsed;
  base.mcpServers = servers;
  writeText(root, '.cursor/mcp.json', `${JSON.stringify(base, null, 2)}\n`);
  return {
    kind: 'mcp',
    name: serverName,
    relativePath: '.cursor/mcp.json',
    content: `${JSON.stringify(parsed, null, 2)}\n`,
  };
}

function saveWholeMcp(root: string, content: string): CursorFileDocument {
  const parsed = parseJson(content, 'mcp.json должен быть корректным JSON.');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CursorFilesError('mcp.json должен быть JSON-объектом.');
  }
  const pretty = `${JSON.stringify(parsed, null, 2)}\n`;
  writeText(root, '.cursor/mcp.json', pretty);
  return {
    kind: 'mcp',
    name: 'mcp.json',
    relativePath: '.cursor/mcp.json',
    content: pretty,
  };
}

function readMcp(root: string, name: string): CursorFileDocument {
  const doc = loadMcp(root);
  if (!doc.exists) throw new CursorFilesError('Файл не найден.');
  if (doc.broken || !doc.value) {
    if (name !== 'mcp.json') {
      throw new CursorFilesError(
        'Конфигурация MCP повреждена. Откройте mcp.json и поправьте JSON.',
      );
    }
    return {
      kind: 'mcp',
      name: 'mcp.json',
      relativePath: '.cursor/mcp.json',
      content: doc.raw,
    };
  }
  const servers = readServers(doc.value);
  if (Object.prototype.hasOwnProperty.call(servers, name)) {
    return {
      kind: 'mcp',
      name,
      relativePath: '.cursor/mcp.json',
      content: `${JSON.stringify(servers[name], null, 2)}\n`,
    };
  }
  if (name === 'mcp.json') {
    return {
      kind: 'mcp',
      name: 'mcp.json',
      relativePath: '.cursor/mcp.json',
      content: `${JSON.stringify(doc.value, null, 2)}\n`,
    };
  }
  throw new CursorFilesError('Файл не найден.');
}

function loadMcp(root: string): {
  exists: boolean;
  broken: boolean;
  value: Record<string, unknown> | null;
  raw: string;
} {
  const path = join(root, '.cursor', 'mcp.json');
  if (!existsSync(path))
    return { exists: false, broken: false, value: null, raw: '' };
  const raw = readFileSync(path, 'utf8');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { exists: true, broken: true, value: null, raw };
    }
    return {
      exists: true,
      broken: false,
      value: parsed as Record<string, unknown>,
      raw,
    };
  } catch {
    return { exists: true, broken: true, value: null, raw };
  }
}

function readServers(doc: Record<string, unknown>): Record<string, unknown> {
  const servers = doc.mcpServers;
  if (servers === undefined) return {};
  if (
    typeof servers !== 'object' ||
    servers === null ||
    Array.isArray(servers)
  ) {
    throw new CursorFilesError(
      'В mcp.json поле mcpServers должно быть объектом.',
    );
  }
  return { ...(servers as Record<string, unknown>) };
}

function ruleFileName(name: string): string {
  const trimmed = name.trim();
  const stem = trimmed.replace(/\.(md|mdc|mdx)$/i, '');
  if (!SEGMENT.test(stem) || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new CursorFilesError('Имя правила не подходит.');
  }
  if (/\.(md|mdc|mdx)$/i.test(trimmed)) return trimmed;
  return `${trimmed}.mdc`;
}

function skillFolder(name: string): string {
  const trimmed = name.trim();
  if (!SEGMENT.test(trimmed))
    throw new CursorFilesError('Имя навыка не подходит.');
  return trimmed;
}

function skillName(rel: string): string {
  const parts = rel.split('/');
  return parts[parts.length - 2] ?? rel;
}

function fileLabel(root: string, rel: string): string {
  return toPosix(
    relative(join(root, '.cursor', 'rules'), join(root, ...rel.split('/'))),
  );
}

function assertKindPath(kind: CursorFileKind, rel: string): void {
  if (kind === 'rule' && RULE_REL.test(rel)) return;
  if (kind === 'skill' && SKILL_REL.test(rel)) return;
  throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
}

function textContent(content: string): string {
  if (typeof content !== 'string')
    throw new CursorFilesError('Нужен текст файла.');
  if (content.length > MAX_TEXT)
    throw new CursorFilesError('Файл слишком большой.');
  return content;
}

function parseJson(content: string, message: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new CursorFilesError(message);
  }
}

function writeText(root: string, rel: string, content: string): void {
  const target = place(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function readText(root: string, rel: string): string {
  const target = place(root, rel);
  let size = 0;
  try {
    const stat = statSync(target);
    if (!stat.isFile()) throw new CursorFilesError('Файл не найден.');
    size = stat.size;
  } catch (error) {
    if (error instanceof CursorFilesError) throw error;
    throw new CursorFilesError('Файл не найден.');
  }
  if (size > MAX_TEXT) throw new CursorFilesError('Файл слишком большой.');
  return readFileSync(target, 'utf8');
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function normalizeRel(input: string): string {
  const trimmed = input.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('\0') || trimmed.startsWith('/')) {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  const parts = trimmed.split('/').filter((part) => part.length > 0);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  return parts.join('/');
}

/** Путь остаётся внутри .cursor, в том числе если по дороге встречается ссылка наружу. */
function place(root: string, relativePath: string): string {
  const rel = normalizeRel(relativePath);
  if (!rel.startsWith('.cursor/')) {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  const lexical = resolve(root, ...rel.split('/'));
  const cursorRoot = join(root, '.cursor');
  if (!inside(cursorRoot, lexical)) {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  const ancestor = existingAncestor(lexical);
  let realAncestor = '';
  try {
    realAncestor = realpathSync(ancestor);
  } catch {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  const realRoot = realpathSync(root);
  if (!inside(realRoot, realAncestor)) {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  const suffix = relative(ancestor, lexical);
  const finalPath = resolve(realAncestor, suffix);
  if (!inside(join(realRoot, '.cursor'), finalPath)) {
    throw new CursorFilesError('Файл должен лежать в .cursor проекта.');
  }
  return lexical;
}

function existingAncestor(path: string): string {
  let current = path;
  for (;;) {
    try {
      statSync(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new CursorFilesError('Папка проекта не найдена.');
      }
      current = parent;
    }
  }
}

function openRoot(folder: string): string | null {
  const found = safeDir(folder);
  if (!found) return null;
  try {
    return realpathSync(found);
  } catch {
    return null;
  }
}

function requiredRoot(folder: string): string {
  const root = openRoot(folder);
  if (!root) throw new CursorFilesError('Папка проекта не найдена.');
  return root;
}

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

function walkFiles(
  dir: string,
  depth: number,
  visit: (full: string) => void,
): void {
  if (depth < 0) return;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkFiles(full, depth - 1, visit);
    else visit(full);
  }
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}
