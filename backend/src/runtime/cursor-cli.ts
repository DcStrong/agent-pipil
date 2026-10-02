/**
 * Локальный Cursor Agent CLI (`agent -p --workspace …`).
 * В тестах подменяется через setCursorCliExecForTests.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  buildPrompt,
  type CursorStepInput,
  type CursorStepResult,
} from './cursor-client';

export const CURSOR_CLI_MISSING_KEY_MESSAGE =
  'Нельзя выполнить шаг Cursor: не задан CURSOR_API_KEY. Выполните `agent login` на машине, где работает backend, или сохраните ключ в настройках.';

export type CliExecInput = {
  binary: string;
  args: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
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

export function isAgentCliAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
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
    if (error instanceof Error && error.message.startsWith('Нельзя')) throw error;
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
      if (error instanceof Error && error.message.startsWith('Нельзя')) throw error;
      throw new Error(
        `Нельзя выполнить шаг Cursor: папка проекта «${input.projectFolder.trim()}» не найдена на сервере.`,
      );
    }
  }
  return workspace;
}

function resolveCliApiKey(
  env: NodeJS.ProcessEnv,
  cliApiKey: string | null | undefined,
): string {
  const key = cliApiKey?.trim() || env.CURSOR_API_KEY?.trim();
  if (!key || key.length < 8) {
    throw new Error(CURSOR_CLI_MISSING_KEY_MESSAGE);
  }
  return key;
}

const defaultExec: CliExecFn = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(input.binary, [...input.args, input.prompt], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Превышено время ожидания ответа Cursor CLI.'));
    }, input.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });

/** Одно задание в папке или workspace через официальный CLI Cursor. */
export async function runCursorCliStep(
  input: CursorStepInput,
  env: NodeJS.ProcessEnv = process.env,
  cliApiKey: string | null = null,
): Promise<CursorStepResult> {
  const binary = resolveAgentBinary(env);
  if (!binary) {
    throw new Error(
      'Нельзя выполнить шаг Cursor: на сервере не найден CLI «agent». Установите Cursor CLI (curl https://cursor.com/install) и добавьте его в PATH на машине, где работает backend.',
    );
  }
  const apiKey = resolveCliApiKey(env, cliApiKey);
  const spawnEnv: NodeJS.ProcessEnv = { ...env, CURSOR_API_KEY: apiKey };
  const workspace = assertWorkspaceExists(input);
  const prompt = buildPrompt(input);
  const cwd =
    input.projectFolder?.trim() ||
    (input.workspaceFile?.trim() ? dirname(input.workspaceFile.trim()) : process.cwd());
  const args = ['-p', '--workspace', workspace];
  const execFn = execForTests ?? defaultExec;
  const result = await execFn({
    binary,
    args,
    cwd,
    prompt,
    timeoutMs: readCliTimeoutMs(env),
    env: spawnEnv,
  });
  if (result.code !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || `код выхода ${result.code ?? '?'}`;
    throw new Error(`Cursor CLI завершился с ошибкой: ${detail}`);
  }
  const text = result.stdout.trim();
  if (!text) {
    throw new Error('Cursor CLI не вернул текст ответа для шага.');
  }
  return {
    agentId: 'local-cli',
    runId: 'local-cli',
    text,
    agentUrl: null,
  };
}
