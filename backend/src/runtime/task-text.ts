/** Разбор текста задачи запуска (заголовок и тело, как на доске). */

export function userPromptFromTask(task: string): string {
  const trimmed = task.trim();
  if (!trimmed) return 'Задача';
  const parts = trimmed.split(/\n\n+/);
  if (parts.length >= 2) {
    const body = parts.slice(1).join('\n\n').trim();
    if (body) return body;
  }
  return trimmed;
}

export function splitRunTask(task: string): { title: string; body: string } {
  const trimmed = task.trim();
  if (!trimmed) return { title: 'Задача', body: '' };
  const parts = trimmed.split(/\n\n+/);
  if (parts.length >= 2) {
    const title = parts[0]?.trim() || 'Задача';
    const body = parts.slice(1).join('\n\n').trim();
    return { title, body };
  }
  return { title: trimmed, body: '' };
}

/** Текст для повторного вызова шага, если CLI не может `--resume`. */
export function retryStepNote(input: {
  stepTitle: string;
  error: string | null;
  priorWork: Array<{ title: string; agentName: string; summary: string }>;
}): string {
  const lines = [
    `Шаг «${input.stepTitle}» прервался и запускается снова.`,
  ];
  if (input.error?.trim()) {
    lines.push(`Последняя ошибка: ${input.error.trim()}`);
  }
  const done = input.priorWork.filter((item) => item.summary.trim());
  if (done.length > 0) {
    lines.push('', 'Уже завершено в этом запуске (не повторяй без нужды):');
    for (const item of done) {
      lines.push(`- ${item.agentName} · ${item.title}: ${item.summary.trim()}`);
    }
  }
  lines.push('', 'Продолжи с места обрыва и доведи этот шаг до конца.');
  return lines.join('\n');
}

/** Короткий ответ имитации на текст владельца. Без обзора диска и без выдачи за живого агента. */
export function simulatedQuestionAnswer(task: string): string {
  const prompt = userPromptFromTask(task);
  const sample =
    prompt.length > 240 ? `${prompt.slice(0, 239)}…` : prompt;
  const lower = prompt.toLowerCase();
  if (/^(привет|здравствуй|здравствуйте|hello|hi)\b/.test(lower)) {
    return [
      'Это имитация: живой Cursor Agent не вызывался.',
      `Вы написали: «${sample}».`,
      'Здравствуйте! Если нужен разбор кода или правки в проекте, опишите это в задаче и запустите процесс с нужными ролями.',
    ].join(' ');
  }
  if (prompt.includes('?')) {
    return [
      'Это имитация: ответ опирается только на текст задачи, файлы на диске не читаются.',
      `Ваш вопрос: «${sample}».`,
      'В рабочем режиме с Cursor CLI или API сюда попадёт тот же текст задачи, а агент сможет смотреть проект.',
    ].join(' ');
  }
  return [
    'Это имитация: живой агент не вызывался.',
    `Вы написали: «${sample}».`,
    'Кратко: принял формулировку. Для реальной работы с репозиторием выберите среду Cursor и процесс с ролями разработки.',
  ].join(' ');
}
