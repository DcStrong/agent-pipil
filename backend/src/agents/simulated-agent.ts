import { Injectable } from '@nestjs/common';
import type { AgentContext, AgentSkill, AgentTurn } from '../domain';
import type { AgentRuntime } from './agent-runtime';

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function subjectOf(task: string): string {
  const line = task.trim().split('\n')[0] ?? 'Task';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function skillLines(skills: AgentSkill[]): string {
  if (skills.length === 0) return '- No skills attached.';
  return skills.map((skill) => `- ${skill.name} (${skill.scope})`).join('\n');
}

function priorBlock(context: AgentContext): string {
  const last = context.priorWork[context.priorWork.length - 1];
  if (!last) return 'This is the first role in the pipeline.';
  return `Received from ${last.roleName}: ${excerpt(last.output, 320)}`;
}

function finish(summary: string, lines: string[]): AgentTurn {
  return { summary, output: lines.join('\n') };
}

@Injectable()
export class SimulatedAgent implements AgentRuntime {
  readonly mode = 'simulated' as const;

  complete(context: AgentContext): Promise<AgentTurn> {
    const key = context.roleName.trim().toLowerCase();
    if (key === 'analyst') return Promise.resolve(this.analyst(context));
    if (key === 'architect') return Promise.resolve(this.architect(context));
    if (key === 'developer') return Promise.resolve(this.developer(context));
    if (key === 'reviewer') return Promise.resolve(this.reviewer(context));
    return Promise.resolve(this.generic(context));
  }

  private analyst(context: AgentContext): AgentTurn {
    const subject = subjectOf(context.task);
    return finish(`Problem framed: ${subject}`, [
      '## Analysis',
      subject,
      '',
      '### Problem',
      context.task.trim(),
      '',
      priorBlock(context),
      '',
      '### Assumptions',
      '- The task text is the whole scope for this run.',
      '- A later role will choose the approach. This note does not.',
      '',
      '### Success criteria',
      '- The outcome matches the task above.',
      '- The next role can continue without a restatement.',
      '- The final result can be read on its own.',
      '',
      '### Skills applied',
      skillLines(context.skills),
      '',
      '### Handoff',
      context.outgoingHandoff || 'Pass the problem and the success criteria.',
    ]);
  }

  private architect(context: AgentContext): AgentTurn {
    const subject = subjectOf(context.task);
    return finish(`Approach chosen for ${subject}`, [
      '## Approach',
      subject,
      '',
      priorBlock(context),
      '',
      '### Design',
      '- Keep one path that satisfies the success criteria.',
      '- Split the work into a request, the change itself, and a check.',
      '- Do not add a second feature beside the task.',
      '',
      '### Parts',
      '1. Accept the task as the brief.',
      '2. Make the smallest change that meets the criteria.',
      '3. Leave a check the reviewer can repeat.',
      '',
      '### Skills applied',
      skillLines(context.skills),
      '',
      '### Handoff',
      context.outgoingHandoff || 'Pass the parts to build.',
    ]);
  }

  private developer(context: AgentContext): AgentTurn {
    const subject = subjectOf(context.task);
    return finish(`Changes named for ${subject}`, [
      '## Changes',
      subject,
      '',
      priorBlock(context),
      '',
      '### What to change',
      `1. Implement only this request: ${excerpt(context.task, 240)}`,
      '2. Keep behavior the task does not mention.',
      '3. Record an edge case: empty input, and a path that completes.',
      '',
      '### How to tell it works',
      '- The original request is still recognizable in the result.',
      '- No extra capability showed up along the way.',
      '',
      '### Skills applied',
      skillLines(context.skills),
      '',
      '### Handoff',
      context.outgoingHandoff || 'Pass the changes and the risks.',
    ]);
  }

  private reviewer(context: AgentContext): AgentTurn {
    const subject = subjectOf(context.task);
    return finish(`Approve with notes — ${subject}`, [
      '## Review',
      subject,
      '',
      priorBlock(context),
      '',
      '### Check',
      '- The work stays on the original task.',
      '- Analysis, approach, and changes are present for the reviewer.',
      context.incomingHandoff
        ? `- Incoming handoff: ${context.incomingHandoff}`
        : '- No incoming handoff was set.',
      '',
      '### Skills applied',
      skillLines(context.skills),
      '',
      '### Verdict',
      'Approve with notes. The pipeline kept the task intact from role to role.',
      '',
      '## Final result',
      `Done: ${subject}.`,
      'The analyst framed the problem, the architect kept the approach small, and the developer named the changes and a check. Nothing outside that request was added.',
    ]);
  }

  private generic(context: AgentContext): AgentTurn {
    const subject = subjectOf(context.task);
    const closing = context.isFinalStage
      ? [
          '## Final result',
          `Done: ${subject}. ${context.roleName} closed the pipeline.`,
        ]
      : [
          '### Handoff',
          context.outgoingHandoff || 'Pass this note to the next role.',
        ];
    return finish(`${context.roleName} finished ${subject}`, [
      `## ${context.roleName}`,
      subject,
      '',
      context.systemPrompt,
      '',
      priorBlock(context),
      '',
      '### Skills applied',
      skillLines(context.skills),
      '',
      ...closing,
    ]);
  }
}
