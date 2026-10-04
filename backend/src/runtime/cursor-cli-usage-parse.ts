import type { CursorStepUsageCapture } from './cursor-usage';

const AGENT_ID = /\b(agent-[0-9a-f-]{8,})\b/i;
const RUN_ID = /\b(run-[0-9a-f-]{8,})\b/i;

function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUsageFields(record: Record<string, unknown>): CursorStepUsageCapture['runUsage'] {
  const inputTokens = numberField(record, 'inputTokens');
  const outputTokens = numberField(record, 'outputTokens');
  const cacheReadTokens = numberField(record, 'cacheReadTokens');
  const cacheWriteTokens = numberField(record, 'cacheWriteTokens');
  let totalTokens = numberField(record, 'totalTokens');
  if (
    inputTokens === null ||
    outputTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null
  ) {
    return null;
  }
  if (totalTokens === null) {
    totalTokens =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  }
  if (totalTokens <= 0) return null;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/** Ищет JSON с полями TokenUsage в stdout/stderr CLI. */
export function parseTokenUsageFromCliOutput(
  text: string,
): CursorStepUsageCapture['runUsage'] {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isUsageRecord(parsed)) continue;
      if (isUsageRecord(parsed.usage)) {
        const nested = readUsageFields(parsed.usage);
        if (nested) return nested;
      }
      const direct = readUsageFields(parsed);
      if (direct) return direct;
    } catch {
      // Следующая строка.
    }
  }
  for (const line of lines) {
    const match = line.match(
      /inputTokens["']?\s*[:=]\s*(\d+)[\s\S]*outputTokens["']?\s*[:=]\s*(\d+)/i,
    );
    if (!match) continue;
    const inputTokens = Number(match[1]);
    const outputTokens = Number(match[2]);
    if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) continue;
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: inputTokens + outputTokens,
    };
  }
  return null;
}

export function parseAgentIdFromCliOutput(text: string): string | null {
  const match = text.match(AGENT_ID);
  return match?.[1] ?? null;
}

export function parseRunIdFromCliOutput(text: string): string | null {
  const match = text.match(RUN_ID);
  return match?.[1] ?? null;
}

export function buildCliUsageCapture(
  stdout: string,
  stderr: string,
): CursorStepUsageCapture {
  const blob = `${stdout}\n${stderr}`;
  const runUsage = parseTokenUsageFromCliOutput(blob);
  const sources: CursorStepUsageCapture['sources'] = [];
  if (runUsage) sources.push('cli-output');
  return {
    runUsage,
    billedUsage: null,
    chargedCents: null,
    sources,
  };
}
