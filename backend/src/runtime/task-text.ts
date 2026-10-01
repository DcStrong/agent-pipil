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
