/**
 * Вход и статус локального CLI (`agent login`, `agent status`, `agent logout`).
 * В тестах подменяется через setCliAuthExecForTests.
 *
 * Формат ссылки (по документации Cursor и типичному выводу CLI):
 * https://cursor.com/loginDeepControl?challenge=…&uuid=…&mode=login&redirectTarget=cli
 * PKCE-пара challenge привязан к процессу `agent login`, который должен оставаться запущенным.
 */
import { resolveAgentBinary } from './cursor-cli';
import { spawnAgentProcess, type AgentSpawnFn } from './cursor-cli-spawn';

export type CliAuthStatus = {
  signedIn: boolean;
  accountLabel: string | null;
};

export type CliLoginPhase = 'idle' | 'pending' | 'success' | 'failed';

export type CliLoginSnapshot = {
  status: CliLoginPhase;
  loginUrl: string | null;
  message: string | null;
};

export const CLI_LOGIN_NO_URL_MESSAGE =
  'CLI не выдал ссылку для входа. Попробуйте «Войти через Cursor» ещё раз или сохраните ключ CURSOR_API_KEY.';

export const CLI_LOGIN_FAILED_MESSAGE =
  'Вход не завершён. Откройте свежую ссылку сразу после «Войти через Cursor» (не старую вкладку). Браузер и backend должны быть на одной машине, пока на сервере работает `agent login`.';

/** Точное совпадение с loginDeepControl без перекодирования query. */
export const LOGIN_DEEP_CONTROL_PATTERN =
  /https:\/\/cursor\.com\/loginDeepControl\?[A-Za-z0-9_\-./%+&=]+/i;

const LOGIN_DEEP_CONTROL_START = 'https://cursor.com/loginDeepControl?';
const LOGIN_DEEP_CONTROL_END = 'redirectTarget=cli';

let authExecForTests: AgentSpawnFn | null = null;

export function setCliAuthExecForTests(fn: AgentSpawnFn | null): void {
  authExecForTests = fn;
}

const GENERIC_HTTPS_PATTERN = /https:\/\/[^\s"'`<>\u0000-\u001f\]]+/gi;

/** Убирает ANSI/CSI/OSC и прочий терминальный шум из вывода CLI. */
export function stripTerminalAnsi(text: string): string {
  let cleaned = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  cleaned = cleaned.replace(/\x1b\[[0-9?]*[ -/]*[@-~]/g, '');
  cleaned = cleaned.replace(/\x9b[0-9?]*[ -/]*[@-~]/g, '');
  cleaned = cleaned.replace(/\x1b\[[0-9;]*m/g, '');
  return cleaned;
}

/** @deprecated Используйте stripTerminalAnsi; оставлено для совместимости тестов. */
export function stripTerminalNoise(text: string): string {
  return stripTerminalAnsi(text);
}

function validateDeepLoginUrl(url: string): boolean {
  if (!url.toLowerCase().startsWith(LOGIN_DEEP_CONTROL_START.toLowerCase())) {
    return false;
  }
  const query = url.slice(LOGIN_DEEP_CONTROL_START.length);
  if (!query.endsWith(LOGIN_DEEP_CONTROL_END)) {
    return false;
  }
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const challenge = params.get('challenge');
  const uuid = params.get('uuid');
  if (!challenge || challenge.length === 0) return false;
  if (!uuid || uuid.length === 0 || /\s/.test(uuid)) return false;
  if (params.get('mode') !== 'login') return false;
  if (params.get('redirectTarget') !== 'cli') return false;
  return true;
}

/**
 * Из буфера stdout/stderr CLI — ссылка loginDeepControl без пробелов и переносов.
 * Значения query не перекодируются.
 */
export function extractDeepLoginUrlFromBuffer(text: string): string | null {
  const cleaned = stripTerminalAnsi(text).replace(/\r/g, '');
  const lower = cleaned.toLowerCase();
  const start = lower.indexOf(LOGIN_DEEP_CONTROL_START.toLowerCase());
  if (start < 0) return null;
  const tail = cleaned.slice(start);
  const endRel = tail.toLowerCase().indexOf(LOGIN_DEEP_CONTROL_END.toLowerCase());
  if (endRel < 0) return null;
  const slice = tail.slice(0, endRel + LOGIN_DEEP_CONTROL_END.length);
  const compact = slice.replace(/[\s\u0000-\u001f]+/g, '');
  return validateDeepLoginUrl(compact) ? compact : null;
}

/** @deprecated Старый путь нормализации; для новых ссылок используйте extractDeepLoginUrlFromBuffer. */
export function normalizeCliLoginOutput(text: string): string {
  const cleaned = stripTerminalAnsi(text).replace(/\r/g, '');
  const deep = extractDeepLoginUrlFromBuffer(cleaned);
  if (deep) return deep;
  return cleaned.replace(/\n+/g, ' ');
}

function trimLoginUrlSuffix(url: string): string {
  return url.replace(/[),.;\]]+$/u, '');
}

function scoreLoginUrl(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('logindeepcontrol')) return 1_000_000 + url.length;
  if (lower.includes('logindeep')) return 900_000 + url.length;
  if (lower.includes('mode=login')) return 800_000 + url.length;
  return url.length;
}

/** Из текста CLI — URL входа (loginDeepControl без пробелов; прочие https — как раньше). */
export function extractLoginUrl(text: string): string | null {
  const deep = extractDeepLoginUrlFromBuffer(text);
  if (deep) return deep;
  const normalized = stripTerminalAnsi(text).replace(/\r/g, '').replace(/\n+/g, ' ');
  const matches = normalized.match(GENERIC_HTTPS_PATTERN);
  if (!matches?.length) return null;
  let best = trimLoginUrlSuffix(matches[0]!);
  let bestScore = scoreLoginUrl(best);
  for (const raw of matches) {
    const candidate = trimLoginUrlSuffix(raw);
    const score = scoreLoginUrl(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best.length > 0 ? best : null;
}

function parseStatusJson(raw: string): CliAuthStatus | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const signedIn =
      value.authenticated === true ||
      value.isAuthenticated === true ||
      value.loggedIn === true;
    const email =
      typeof value.email === 'string'
        ? value.email
        : typeof value.user === 'object' &&
            value.user !== null &&
            typeof (value.user as { email?: unknown }).email === 'string'
          ? ((value.user as { email: string }).email ?? null)
          : typeof value.account === 'object' &&
              value.account !== null &&
              typeof (value.account as { email?: unknown }).email === 'string'
            ? ((value.account as { email: string }).email ?? null)
            : null;
    if (signedIn) {
      return { signedIn: true, accountLabel: email };
    }
    if (
      value.authenticated === false ||
      value.isAuthenticated === false ||
      value.loggedIn === false
    ) {
      return { signedIn: false, accountLabel: null };
    }
  } catch {
    // Не JSON — пробуем текстовый status.
  }
  return null;
}

export function parseStatusText(text: string): CliAuthStatus {
  const json = parseStatusJson(text.trim());
  if (json) return json;
  const lower = text.toLowerCase();
  if (
    lower.includes('not authenticated') ||
    lower.includes('not logged in') ||
    lower.includes('не авториз')
  ) {
    return { signedIn: false, accountLabel: null };
  }
  const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w+/);
  if (
    lower.includes('authenticated') ||
    lower.includes('logged in') ||
    emailMatch
  ) {
    return { signedIn: true, accountLabel: emailMatch?.[0] ?? null };
  }
  return { signedIn: false, accountLabel: null };
}

async function runAuthCommand(
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const binary = resolveAgentBinary(env);
  if (!binary) {
    throw new Error('CLI «agent» не найден на сервере.');
  }
  const execFn = authExecForTests ?? spawnAgentProcess;
  return execFn({
    binary,
    args,
    cwd: process.cwd(),
    env,
    timeoutMs,
    onChunk,
  });
}

function trackLoginUrl(
  buffer: string,
  bestUrl: string | null,
  onUrl?: (url: string) => void,
): string | null {
  const found = extractLoginUrl(buffer);
  if (!found) return bestUrl;
  if (!bestUrl || scoreLoginUrl(found) > scoreLoginUrl(bestUrl)) {
    onUrl?.(found);
    return found;
  }
  return bestUrl;
}

export async function queryCliAuthStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliAuthStatus> {
  if (!resolveAgentBinary(env)) {
    return { signedIn: false, accountLabel: null };
  }
  const jsonResult = await runAuthCommand(
    ['status', '--format', 'json'],
    env,
    15_000,
  );
  const jsonMerged = `${jsonResult.stdout}\n${jsonResult.stderr}`.trim();
  if (jsonMerged) {
    const fromJson = parseStatusJson(jsonMerged);
    if (fromJson !== null) {
      return fromJson;
    }
  }
  const fallback = await runAuthCommand(['status'], env, 15_000);
  const fallbackMerged = `${fallback.stdout}\n${fallback.stderr}`.trim();
  if (!fallbackMerged) {
    return { signedIn: false, accountLabel: null };
  }
  return parseStatusText(fallbackMerged);
}

export type CliLoginOutcome = {
  ok: boolean;
  message: string | null;
  loginUrl: string | null;
  /** Полный буфер stdout/stderr login (только для тестов и диагностики извлечения). */
  rawOutput: string;
};

export async function runCliLogin(
  env: NodeJS.ProcessEnv = process.env,
  onUrl?: (url: string) => void,
  onStatusCheck?: () => Promise<void>,
): Promise<CliLoginOutcome> {
  const loginEnv: NodeJS.ProcessEnv = { ...env, NO_OPEN_BROWSER: '1' };
  let streamBuffer = '';
  let bestUrl: string | null = null;
  const statusPoll = setInterval(() => {
    void onStatusCheck?.().catch(() => undefined);
  }, 2_000);
  let result: { stdout: string; stderr: string; code: number | null };
  try {
    result = await runAuthCommand(
      ['login'],
      loginEnv,
      600_000,
      (_stream, chunk) => {
        streamBuffer += chunk;
        bestUrl = trackLoginUrl(streamBuffer, bestUrl, onUrl);
      },
    );
  } finally {
    clearInterval(statusPoll);
  }
  const merged = `${streamBuffer}\n${result.stdout}\n${result.stderr}`;
  bestUrl = trackLoginUrl(merged, bestUrl, onUrl);
  const rawOutput = merged;
  const authStatus = await queryCliAuthStatus(env);

  if (authStatus.signedIn && result.code === 0) {
    return { ok: true, message: null, loginUrl: bestUrl, rawOutput };
  }
  if (authStatus.signedIn && result.code !== 0) {
    return { ok: true, message: null, loginUrl: bestUrl, rawOutput };
  }
  if (!bestUrl) {
    return {
      ok: false,
      message: CLI_LOGIN_NO_URL_MESSAGE,
      loginUrl: null,
      rawOutput,
    };
  }
  if (result.code !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    return {
      ok: false,
      message: detail || CLI_LOGIN_FAILED_MESSAGE,
      loginUrl: bestUrl,
      rawOutput,
    };
  }
  return {
    ok: false,
    message: CLI_LOGIN_FAILED_MESSAGE,
    loginUrl: bestUrl,
    rawOutput,
  };
}

export async function runCliLogout(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await runAuthCommand(['logout'], env, 30_000);
  if (result.code !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(detail || `agent logout завершился с кодом ${result.code ?? '?'}`);
  }
}
