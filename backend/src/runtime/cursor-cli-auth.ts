/**
 * Вход и статус локального CLI (`agent login`, `agent status`, `agent logout`).
 * В тестах подменяется через setCliAuthExecForTests.
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

let authExecForTests: AgentSpawnFn | null = null;

export function setCliAuthExecForTests(fn: AgentSpawnFn | null): void {
  authExecForTests = fn;
}

const LOGIN_URL_PATTERN = /https:\/\/[^\s"'<>]+/i;

export function extractLoginUrl(text: string): string | null {
  const match = text.match(LOGIN_URL_PATTERN);
  if (!match) return null;
  return match[0]!.replace(/[),.]+$/, '');
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
    // Текстовый вывод status.
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

export async function queryCliAuthStatus(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CliAuthStatus> {
  if (!resolveAgentBinary(env)) {
    return { signedIn: false, accountLabel: null };
  }
  const result = await runAuthCommand(
    ['status', '--format', 'json'],
    env,
    15_000,
  );
  const merged = `${result.stdout}\n${result.stderr}`.trim();
  if (merged) {
    const parsed = parseStatusText(merged);
    if (parsed.signedIn || result.code === 0) return parsed;
  }
  const fallback = await runAuthCommand(['status'], env, 15_000);
  return parseStatusText(`${fallback.stdout}\n${fallback.stderr}`);
}

export async function runCliLogin(
  env: NodeJS.ProcessEnv = process.env,
  onUrl?: (url: string) => void,
): Promise<{ ok: boolean; message: string | null }> {
  const loginEnv: NodeJS.ProcessEnv = { ...env, NO_OPEN_BROWSER: '1' };
  const result = await runAuthCommand(
    ['login'],
    loginEnv,
    600_000,
    (_stream, chunk) => {
      const url = extractLoginUrl(chunk);
      if (url) onUrl?.(url);
    },
  );
  const detail = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code === 0) {
    return { ok: true, message: null };
  }
  return {
    ok: false,
    message: detail || `Код выхода ${result.code ?? '?'}`,
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
