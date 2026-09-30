import type { AgentContext, AgentTurn } from '../domain';
import type { AgentRuntime } from './agent-runtime';

export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function systemMessage(context: AgentContext): string {
  const skills = context.skills
    .map(
      (skill) => `Skill (${skill.scope}): ${skill.name}\n${skill.instructions}`,
    )
    .join('\n\n');
  const closing = context.isFinalStage
    ? 'End with a section titled "Final result" that a person can read without the earlier stages.'
    : 'End with a short handoff the next role can continue from.';
  return [context.systemPrompt, skills, closing].filter(Boolean).join('\n\n');
}

function userMessage(context: AgentContext): string {
  const prior =
    context.priorWork.length === 0
      ? 'No earlier role has written yet.'
      : context.priorWork
          .map((item) => `## ${item.roleName}\n${item.output}`)
          .join('\n\n');
  const incoming = context.incomingHandoff
    ? `Handoff from the previous role:\n${context.incomingHandoff}`
    : 'There is no handoff from a previous role.';
  const outgoing = context.outgoingHandoff
    ? `Handoff you must leave for the next role:\n${context.outgoingHandoff}`
    : 'You are not required to leave a handoff note.';
  return [
    `Task:\n${context.task}`,
    incoming,
    outgoing,
    `Earlier work:\n${prior}`,
  ].join('\n\n');
}

function summaryFrom(output: string): string {
  const line = output
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.length > 0 && !item.startsWith('#'));
  const summary = line ?? 'The role finished this stage.';
  return summary.length > 140 ? `${summary.slice(0, 139)}…` : summary;
}

export class ModelAgent implements AgentRuntime {
  readonly mode = 'model' as const;

  constructor(private readonly config: ModelConfig) {}

  async complete(context: AgentContext): Promise<AgentTurn> {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemMessage(context) },
          { role: 'user', content: userMessage(context) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = readError(payload);
      throw new Error(
        detail ??
          `The model request failed (${response.status}). Check MODEL_API_KEY and MODEL_BASE_URL.`,
      );
    }
    const output = readContent(payload);
    if (!output) {
      throw new Error('The model returned an empty reply.');
    }
    return { output, summary: summaryFrom(output) };
  }
}

function readError(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const error = (payload as { error?: { message?: unknown } }).error;
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return null;
}

function readContent(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const message = (first as { message?: { content?: unknown } }).message;
  if (!message || typeof message.content !== 'string') return null;
  const text = message.content.trim();
  return text.length > 0 ? text : null;
}
