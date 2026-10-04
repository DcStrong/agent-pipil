/**
 * Клиент Cloud Agents API Cursor (https://api.cursor.com/v1/agents).
 * В тестах сеть подменяется через injectable fetch.
 */
import { readGitRemoteUrl } from './saved-project';
import { fetchCloudCursorStepUsage } from './cursor-sdk-usage';
import type { CursorStepUsageCapture } from './cursor-usage';

export interface CursorStepInput {
  token: string;
  task: string;
  stepTitle: string;
  agentName: string;
  instructions: string;
  skills: Array<{ name: string; instructions: string }>;
  projectFolder: string | null;
  workspaceFile: string | null;
  /** Продолжение того же чата agent через `--resume`, если CLI это поддерживает. */
  resumeChatId?: string | null;
  /** Короткая пометка для промпта, если resume недоступен. */
  retryNote?: string | null;
}

export interface CursorStepResult {
  agentId: string;
  runId: string;
  text: string;
  agentUrl: string | null;
  usageCapture: CursorStepUsageCapture | null;
  /** Id для `--resume` на следующем вызове этого шага. */
  cliChatId: string | null;
}

type FetchFn = typeof fetch;

const TERMINAL = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);

/** Локальная сессия уже открыта в окружении. Это не повод звать сетевой API. */
export function hasLocalCursorSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['CURSOR_AGENT', 'CURSOR_SESSION_ID', 'CURSOR_CONVERSATION_ID'].some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function authHeader(token: string): string {
  return `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; code?: string };
      message?: string;
    };
    if (body.error?.message) return body.error.message;
    if (typeof body.message === 'string' && body.message) return body.message;
  } catch {
    // Тело не JSON — ниже общий текст.
  }
  return `HTTP ${response.status}`;
}

export function buildPrompt(input: CursorStepInput): string {
  const lines = [
    `Шаг «${input.stepTitle}», агент «${input.agentName}».`,
    '',
    'Задача запуска:',
    input.task,
    '',
    'Инструкции агента:',
    input.instructions,
  ];
  if (input.skills.length > 0) {
    lines.push('', 'Навыки:');
    for (const skill of input.skills) {
      lines.push(`- ${skill.name}: ${skill.instructions}`);
    }
  }
  if (input.workspaceFile) {
    lines.push(
      '',
      `Рабочая область Cursor (файл): ${input.workspaceFile}`,
    );
  }
  if (input.projectFolder) {
    lines.push('', `Локальный проект на машине пользователя: ${input.projectFolder}`);
    lines.push(
      'Код и тесты выполняются на машине пользователя, не внутри облачного агента, если репозиторий не подключён.',
    );
  }
  if (input.retryNote?.trim()) {
    lines.push('', '---', 'Продолжение после сбоя:', input.retryNote.trim());
  }
  lines.push('', 'Ответь по-русски, кратко и по делу.');
  return lines.join('\n');
}

export class CursorClient {
  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly baseUrl = 'https://api.cursor.com',
  ) {}

  /** Живой режим включён, если не задан явный запрет CURSOR_LIVE=0. */
  liveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CURSOR_LIVE !== '0';
  }

  async runStep(input: CursorStepInput): Promise<CursorStepResult> {
    const token = input.token.trim();
    if (token.length < 8) {
      throw new Error(
        'Нельзя вызвать Cursor: API-токен не сохранён на сервере. Задайте токен в настройках.',
      );
    }
    const promptText = buildPrompt(input);
    const repos: Array<{ url: string }> = [];
    if (input.projectFolder) {
      const remote = readGitRemoteUrl(input.projectFolder);
      if (remote) repos.push({ url: remote });
    }
    const body: Record<string, unknown> = {
      prompt: { text: promptText },
      name: `${input.agentName}: ${input.stepTitle}`.slice(0, 100),
      autoCreatePR: false,
    };
    if (repos.length > 0) body.repos = repos;

    const created = await this.request<{ agent: { id: string; url?: string }; run: { id: string } }>(
      token,
      'POST',
      '/v1/agents',
      body,
    );
    const agentId = created.agent.id;
    const runId = created.run.id;
    const agentUrl =
      typeof created.agent.url === 'string' ? created.agent.url : null;

    const finished = await this.waitForRun(token, agentId, runId);
    if (finished.status === 'ERROR') {
      throw new Error(
        finished.result?.trim()
          ? `Cursor завершил шаг с ошибкой: ${finished.result}`
          : 'Cursor завершил шаг с ошибкой.',
      );
    }
    if (finished.status === 'CANCELLED') {
      throw new Error('Cursor отменил шаг.');
    }
    if (finished.status === 'EXPIRED') {
      throw new Error('Время ожидания ответа Cursor истекло.');
    }
    const text = finished.result?.trim();
    if (!text) {
      throw new Error('Cursor не вернул текст ответа для шага.');
    }
    let usageCapture = null;
    try {
      usageCapture = await fetchCloudCursorStepUsage(agentId, runId, token);
    } catch {
      usageCapture = null;
    }
    return {
      agentId,
      runId,
      text,
      agentUrl,
      usageCapture,
      cliChatId: null,
    };
  }

  private async waitForRun(
    token: string,
    agentId: string,
    runId: string,
  ): Promise<{ status: string; result?: string }> {
    const deadline = Date.now() + readPollTimeoutMs();
    let delay = 400;
    while (Date.now() < deadline) {
      const run = await this.request<{ status: string; result?: string }>(
        token,
        'GET',
        `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
      );
      if (TERMINAL.has(run.status)) return run;
      await sleep(delay);
      delay = Math.min(delay + 200, 3000);
    }
    throw new Error('Превышено время ожидания ответа Cursor.');
  }

  private async request<T>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: authHeader(token),
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await readApiError(response);
      throw new Error(`Не удалось вызвать Cursor: ${detail}`);
    }
    return (await response.json()) as T;
  }
}

function readPollTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CURSOR_POLL_MS;
  if (raw === undefined || raw.trim() === '') return 120_000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1000) return 120_000;
  return Math.min(value, 600_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
