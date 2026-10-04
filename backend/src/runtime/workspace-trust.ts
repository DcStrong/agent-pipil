import { resolve } from 'node:path';

/** Абсолютный путь без хвостового слэша, чтобы «всегда» совпадало с тем, что ушло в CLI. */
export function normalizeAccessPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  return resolve(trimmed);
}

export function isWorkspaceTrustRequired(text: string): boolean {
  return /workspace trust required/i.test(text);
}

export class WorkspaceTrustRequiredError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `Cursor просит доверять папке «${path}». Разрешите доступ в запуске: всегда, один раз или отклоните.`,
    );
    this.name = 'WorkspaceTrustRequiredError';
    this.path = path;
  }
}
