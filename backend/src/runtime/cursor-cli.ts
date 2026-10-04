/**
 * Локальный Cursor Agent CLI (`agent -p --workspace …`).
 * В тестах подменяется через setCursorCliExecForTests.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildPrompt,
  type CursorStepInput,
  type CursorStepResult,
} from './cursor-client';
import { spawnAgentProcess } from './cursor-cli-spawn';
import { fetchCliCursorStepUsage } from './cursor-sdk-usage';
import { CliStreamDecoder, type CliTrace } from './cursor-cli-stream';
import {
  holdSessionShellAllows,
  ShellApprovalRequiredError,
  shellCommandBase,
} from './shell-allow';
import {
  isWorkspaceTrustRequired,
  WorkspaceTrustRequiredError,
} from './workspace-trust';

export const CURSOR_CLI_MISSING_AUTH_MESSAGE =
  'Нельзя выполнить шаг Cursor: нет входа в CLI и не задан CURSOR_API_KEY. Нажмите «Войти через Cursor» в настройках или сохраните ключ.';

/** @deprecated используйте CURSOR_CLI_MISSING_AUTH_MESSAGE */
export const CURSOR_CLI_MISSING_KEY_MESSAGE = CURSOR_CLI_MISSING_AUTH_MESSAGE;

export type CliExecInput = {
  binary: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void;
};

export type CliExecFn = (input: CliExecInput) => Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}>;

let execForTests: CliExecFn | null = null;

/** Только для unit-тестов: не запускает настоящий CLI. */
export function setCursorCliExecForTests(fn: CliExecFn | null): void {
  execForTests = fn;
}

export function resolveAgentBinary(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.CURSOR_AGENT_BIN?.trim();
  if (override) {
    try {
      accessSync(override, constants.X_OK);
      return override;
    } catch {
      return null;
    }
  }
  for (const dir of (env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = join(dir, 'agent');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Следующий каталог PATH.
    }
  }
  return null;
}

export function isAgentCliAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAgentBinary(env) !== null;
}

function readCliTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CURSOR_CLI_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return 600_000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1000) return 600_000;
  return Math.min(value, 3_600_000);
}

function workspacePath(input: CursorStepInput): string {
  if (input.workspaceFile?.trim()) return input.workspaceFile.trim();
  if (input.projectFolder?.trim()) return input.projectFolder.trim();
  throw new Error(
    'Нельзя выполнить шаг Cursor: не указана папка проекта или файл workspace на сервере.',
  );
}

function assertWorkspaceExists(input: CursorStepInput): string {
  const workspace = workspacePath(input);
  try {
    const stat = statSync(workspace);
    if (input.workspaceFile?.trim()) {
      if (!stat.isFile()) {
        throw new Error(
          `Нельзя выполнить шаг Cursor: файл workspace «${workspace}» не найден на сервере.`,
        );
      }
    } else if (!stat.isDirectory()) {
      throw new Error(
        `Нельзя выполнить шаг Cursor: папка проекта «${workspace}» не найдена на сервере.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Нельзя'))
      throw error;
    throw new Error(
      `Нельзя выполнить шаг Cursor: путь «${workspace}» не найден на сервере.`,
    );
  }
  if (input.projectFolder?.trim()) {
    try {
      if (!statSync(input.projectFolder.trim()).isDirectory()) {
        throw new Error(
          `Нельзя выполнить шаг Cursor: папка проекта «${input.projectFolder.trim()}» не найдена на сервере.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Нельзя'))
        throw error;
      throw new Error(
        `Нельзя выполнить шаг Cursor: папка проекта «${input.projectFolder.trim()}» не найдена на сервере.`,
      );
    }
  }
  return workspace;
}

function buildCliSpawnEnv(
  env: NodeJS.ProcessEnv,
  cliApiKey: string | null | undefined,
): NodeJS.ProcessEnv {
  const key = cliApiKey?.trim() || env.CURSOR_API_KEY?.trim();
  if (key && key.length >= 8) {
    return { ...env, CURSOR_API_KEY: key };
  }
  return { ...env };
}

const defaultExec: CliExecFn = (input) =>
  spawnAgentProcess({
    binary: input.binary,
    args: [...input.args, input.prompt],
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs,
    onChunk: input.onChunk,
  });

/** Одно задание в папке или workspace через официальный CLI Cursor. */
export async function runCursorCliStep(
  input: CursorStepInput,
  env: NodeJS.ProcessEnv = process.env,
  cliApiKey: string | null = null,
  options?: {
    trust?: boolean;
    onTrace?: (trace: CliTrace) => void;
    /** Первое слово команды уже можно запускать. */
    shellAllowed?: (base: string) => boolean;
    /** «Один раз»: токены только на время этого процесса. */
    sessionShellBases?: string[];
    /** Id чата, как только он появился в стриме. */
    onSession?: (id: string) => void;
  },
): Promise<CursorStepResult> {
  const binary = resolveAgentBinary(env);
  if (!binary) {
    throw new Error(
      'Нельзя выполнить шаг Cursor: на сервере не найден CLI «agent». Установите Cursor CLI (curl https://cursor.com/install) и добавьте его в PATH на машине, где работает backend.',
    );
  }
  const spawnEnv = buildCliSpawnEnv(env, cliApiKey);
  const workspace = assertWorkspaceExists(input);
  const prompt = buildPrompt(input);
  const cwd =
    input.projectFolder?.trim() ||
    (input.workspaceFile?.trim()
      ? dirname(input.workspaceFile.trim())
      : process.cwd());
  const args = ['-p', '--output-format', 'stream-json'];
  const resumeId = input.resumeChatId?.trim();
  if (resumeId) args.push('--resume', resumeId);
  if (options?.trust) args.push('--trust');
  args.push('--workspace', workspace);
  const decoder = new CliStreamDecoder();
  const emit = options?.onTrace ?? (() => undefined);
  const onSession = (id: string) => options?.onSession?.(id);
  const onShell = (command: string) => {
    const base = shellCommandBase(command);
    if (!base || options?.shellAllowed?.(base)) return;
    throw new ShellApprovalRequiredError(command);
  };
  const releaseSession = holdSessionShellAllows(
    input.projectFolder?.trim() || cwd,
    options?.sessionShellBases ?? [],
  );
  let streamed = false;
  const execFn = execForTests ?? defaultExec;
  let result: { stdout: string; stderr: string; code: number | null };
  try {
    result = await execFn({
      binary,
      args,
      cwd,
      prompt,
      timeoutMs: readCliTimeoutMs(env),
      env: spawnEnv,
      onChunk: (stream, text) => {
        if (stream !== 'stdout' || !text) return;
        streamed = true;
        decoder.push(text, emit, onShell, onSession);
      },
    });
    if (!streamed) decoder.push(`${result.stdout}\n`, emit, onShell, onSession);
    decoder.finish(emit, onShell, onSession);
  } finally {
    releaseSession();
  }
  if (result.code !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `код выхода ${result.code ?? '?'}`;
    if (isWorkspaceTrustRequired(detail)) {
      throw new WorkspaceTrustRequiredError(workspace);
    }
    throw new Error(`Cursor CLI завершился с ошибкой: ${detail}`);
  }
  const text = decoder.finalText(result.stdout);
  if (!text) {
    throw new Error('Cursor CLI не вернул текст ответа для шага.');
  }
  const usageCapture = await fetchCliCursorStepUsage(
    result.stdout,
    result.stderr,
    spawnEnv.CURSOR_API_KEY ?? cliApiKey,
  );
  return {
    agentId: 'local-cli',
    runId: 'local-cli',
    text,
    agentUrl: null,
    usageCapture,
    cliSessionId: decoder.sessionId(),
  };
}
