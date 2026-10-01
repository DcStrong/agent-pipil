import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type { SavedProject, SavedProjectKind } from '../domain';

const MAX_PATH = 500;

export function defaultFolderName(kind: SavedProjectKind, path: string): string {
  const base = basename(path);
  if (kind === 'workspace') {
    const ext = extname(base);
    if (ext.toLowerCase() === '.code-workspace') {
      return base.slice(0, -ext.length);
    }
  }
  return base;
}

export function displayName(project: SavedProject): string {
  const alias = project.alias.trim();
  return alias || project.folderName;
}

function safePath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_PATH) return null;
  return resolve(trimmed);
}

export function validateProjectPath(
  kind: SavedProjectKind,
  rawPath: string,
): { path: string; folderName: string } {
  const full = safePath(rawPath);
  if (!full) {
    throw new Error('Путь слишком длинный или пустой.');
  }
  try {
    const stat = statSync(full);
    if (kind === 'folder') {
      if (!stat.isDirectory()) {
        throw new Error('Укажите существующую папку проекта.');
      }
    } else if (!stat.isFile()) {
      throw new Error('Укажите файл рабочей области Cursor (.code-workspace).');
    } else if (!full.toLowerCase().endsWith('.code-workspace')) {
      throw new Error('Файл рабочей области должен иметь расширение .code-workspace.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Укажите')) {
      throw error;
    }
    throw new Error('Путь не найден на этой машине.');
  }
  return { path: full, folderName: defaultFolderName(kind, full) };
}

/** Корневая папка для обхода .cursor и карты. */
export function projectRootForRun(project: SavedProject): string {
  if (project.kind === 'folder') return project.path;
  return resolveWorkspaceFolder(project.path);
}

function resolveWorkspaceFolder(workspaceFile: string): string {
  try {
    const raw = readFileSync(workspaceFile, 'utf8');
    const parsed = JSON.parse(raw) as { folders?: Array<{ path?: string }> };
    const first = parsed.folders?.[0]?.path?.trim();
    if (first) {
      return resolve(dirname(workspaceFile), first);
    }
  } catch {
    // Ниже — запасной вариант: каталог файла workspace.
  }
  return dirname(workspaceFile);
}

export function readGitRemoteUrl(folder: string): string | null {
  try {
    const config = readFileSync(resolve(folder, '.git', 'config'), 'utf8');
    const match = config.match(
      /\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/,
    );
    if (!match?.[1]) return null;
    let url = match[1].trim();
    if (url.endsWith('.git')) url = url.slice(0, -4);
    if (url.startsWith('git@')) {
      const parts = url.slice(4).split(':');
      if (parts.length === 2) url = `https://${parts[0]}/${parts[1]}`;
    }
    if (!/^https?:\/\//.test(url)) return null;
    return url;
  } catch {
    return null;
  }
}
