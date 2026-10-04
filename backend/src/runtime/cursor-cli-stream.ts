/** Разбор `--output-format stream-json` локального CLI Cursor. */

export type CliTrace = {
  kind: 'text' | 'tool';
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return clean;
  return `${clean.slice(0, 157)}…`;
}

function assistantText(event: Record<string, unknown>): string {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return '';
  return message.content
    .map((block) => {
      if (
        !isRecord(block) ||
        block.type !== 'text' ||
        typeof block.text !== 'string'
      ) {
        return '';
      }
      return block.text;
    })
    .join('');
}

/** Полная shell-команда из tool_call, если это вызов терминала. */
export function shellCommandOf(node: unknown): string | null {
  if (!isRecord(node)) return null;
  for (const [key, child] of Object.entries(node)) {
    if (!isRecord(child)) continue;
    const args = isRecord(child.args) ? child.args : null;
    const name = key.replace(/ToolCall$/i, '').toLowerCase();
    if (args && name.includes('shell')) {
      const command = field(args, 'command');
      if (command) return command;
    }
    const nested = shellCommandOf(child);
    if (nested) return nested;
  }
  return null;
}

function describeTool(node: unknown): string | null {
  if (!isRecord(node)) return null;
  for (const [key, child] of Object.entries(node)) {
    if (!isRecord(child)) continue;
    const args = isRecord(child.args) ? child.args : null;
    if (!args) {
      const nested = describeTool(child);
      if (nested) return nested;
      continue;
    }
    const name = key.replace(/ToolCall$/i, '').toLowerCase();
    const path =
      field(args, 'path') ||
      field(args, 'file_path') ||
      field(args, 'target_file');
    const command = field(args, 'command');
    const pattern = field(args, 'pattern') || field(args, 'query');
    if (command) return `Команда: ${clip(command)}`;
    if (pattern) {
      return path
        ? `Ищет «${clip(pattern)}» в ${path}`
        : `Ищет «${clip(pattern)}»`;
    }
    if (
      path &&
      (name.includes('edit') ||
        name.includes('write') ||
        name.includes('delete'))
    ) {
      return `Правит ${path}`;
    }
    if (path) return `Читает ${path}`;
    if (name && name !== key.toLowerCase()) return `Вызов ${name}`;
  }
  return null;
}

/** Копит строки потока и отдаёт короткие следы плюс итоговый result. */
function sessionIdOf(value: Record<string, unknown>): string | null {
  const direct = value.session_id ?? value.sessionId;
  if (typeof direct !== 'string') return null;
  const trimmed = direct.trim();
  return trimmed || null;
}

export class CliStreamDecoder {
  private pending = '';
  private lastText = '';
  private result: string | null = null;
  private seenSession: string | null = null;

  /** Id чата, как только он появился в стриме. Не ждёт конца процесса. */
  sessionId(): string | null {
    return this.seenSession;
  }

  push(
    chunk: string,
    emit: (trace: CliTrace) => void,
    onShell?: (command: string) => void,
    onSession?: (id: string) => void,
  ): void {
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.consume(line, emit, onShell, onSession);
  }

  finish(
    emit: (trace: CliTrace) => void,
    onShell?: (command: string) => void,
    onSession?: (id: string) => void,
  ): void {
    if (this.pending.trim())
      this.consume(this.pending, emit, onShell, onSession);
    this.pending = '';
  }

  finalText(raw: string): string {
    const fromResult = this.result?.trim() ?? '';
    if (fromResult) return fromResult;
    const plain = raw.trim();
    if (plain && !plain.startsWith('{')) return plain;
    return this.lastText.trim() || plain;
  }

  private consume(
    line: string,
    emit: (trace: CliTrace) => void,
    onShell?: (command: string) => void,
    onSession?: (id: string) => void,
  ): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(value)) return;
    const session = sessionIdOf(value);
    if (session && session !== this.seenSession) {
      this.seenSession = session;
      onSession?.(session);
    }
    if (value.type === 'result' && typeof value.result === 'string') {
      this.result = value.result;
      return;
    }
    if (value.type === 'assistant') {
      const text = assistantText(value);
      if (!text) return;
      const delta = text.startsWith(this.lastText)
        ? text.slice(this.lastText.length)
        : text;
      this.lastText = text;
      const clean = delta.trim();
      if (!clean) return;
      emit({ kind: 'text', text: clean });
      return;
    }
    if (value.type === 'tool_call' && value.subtype !== 'completed') {
      const tool = value.tool_call ?? value;
      const command = shellCommandOf(tool);
      if (command) onShell?.(command);
      const text = describeTool(tool);
      if (text) emit({ kind: 'tool', text });
    }
  }
}
