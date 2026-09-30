import type { AgentContext, AgentTurn } from '../domain';

function subjectOf(task: string): string {
  const line = task.trim().split('\n')[0] ?? 'Задача';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

/** Имитация шага. Сеть не вызывается, аккаунт владельца не тратится. */
export class SimulatedAgent {
  complete(context: AgentContext): Promise<AgentTurn> {
    const subject = subjectOf(context.task);
    const last = context.priorWork[context.priorWork.length - 1];
    const received = last
      ? `Получено от «${last.title}» (${last.agentName}): ${excerpt(last.output, 280)}`
      : 'Это первый шаг процесса.';
    const skills =
      context.skills.length === 0
        ? '- Навыки не подключены.'
        : context.skills
            .map(
              (skill) =>
                `- ${skill.name} (${skill.scope === 'shared' ? 'общий' : 'агент'})`,
            )
            .join('\n');
    const closing = context.isFinalStep
      ? [
          '## Итог',
          `Готово: ${subject}.`,
          'План, сборка и проверка остались внутри исходной задачи.',
        ]
      : [
          '### Передача',
          context.outgoingHandoff || 'Передай заметку следующему шагу.',
        ];
    const output = [
      `## ${context.title}`,
      subject,
      '',
      received,
      '',
      '### Навыки',
      skills,
      '',
      ...closing,
    ].join('\n');
    const summary = context.isFinalStep
      ? `Итог: ${subject}`
      : `${context.title}: ${subject}`;
    return Promise.resolve({ output, summary });
  }
}
