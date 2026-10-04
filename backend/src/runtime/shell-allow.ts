import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Первое слово команды: `node .lint-check.mjs` → `node`. */
export function shellCommandBase(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    if (end > 1) return trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/)[0] ?? '';
}

export function shellAllowToken(base: string): string {
  return `Shell(${base})`;
}

export class ShellApprovalRequiredError extends Error {
  readonly command: string;
  readonly base: string;

  constructor(command: string) {
    const base = shellCommandBase(command);
    super(`Нужно разрешение на команду: ${command}`);
    this.name = 'ShellApprovalRequiredError';
    this.command = command;
    this.base = base;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cliJsonPath(folder: string): string {
  return join(folder, '.cursor', 'cli.json');
}

function readConfig(folder: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(cliJsonPath(folder), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function allowList(config: Record<string, unknown> | null): string[] {
  if (!config) return [];
  const permissions = config.permissions;
  if (!isRecord(permissions) || !Array.isArray(permissions.allow)) return [];
  return permissions.allow.filter((item): item is string => typeof item === 'string');
}

export function projectAllowsShell(folder: string, base: string): boolean {
  if (!folder.trim() || !base) return false;
  const allow = allowList(readConfig(folder));
  const token = shellAllowToken(base);
  return allow.some(
    (item) => item === token || item === `Shell(${base}:*)` || item === 'Shell(*)',
  );
}

function writeAllow(folder: string, allow: string[]): void {
  const path = cliJsonPath(folder);
  const current = readConfig(folder) ?? {};
  const permissions = isRecord(current.permissions) ? { ...current.permissions } : {};
  const next = {
    ...current,
    permissions: {
      ...permissions,
      allow,
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/** Добавляет Shell(base) в .cursor/cli.json, не трогая остальные правила. */
export function persistShellAllow(folder: string, base: string): void {
  if (!folder.trim() || !base || /[()\s]/.test(base)) {
    throw new Error('Нельзя сохранить такое разрешение команды.');
  }
  const allow = allowList(readConfig(folder));
  const token = shellAllowToken(base);
  if (allow.includes(token)) return;
  writeAllow(folder, [...allow, token]);
}

export function removeShellAllow(folder: string, base: string): void {
  if (!folder.trim() || !base) return;
  const config = readConfig(folder);
  if (!config) return;
  const allow = allowList(config);
  const token = shellAllowToken(base);
  if (!allow.includes(token)) return;
  writeAllow(
    folder,
    allow.filter((item) => item !== token),
  );
}

/**
 * На время процесса CLI добавляет токены «один раз» и снимает только их.
 * Правила, которые уже были в файле, остаются.
 */
export function holdSessionShellAllows(folder: string, bases: string[]): () => void {
  const added: string[] = [];
  if (folder.trim()) {
    for (const base of bases) {
      if (!base || projectAllowsShell(folder, base)) continue;
      try {
        persistShellAllow(folder, base);
        added.push(base);
      } catch {
        // Кривой токен не блокирует остальные.
      }
    }
  }
  return () => {
    for (const base of added) removeShellAllow(folder, base);
  };
}
