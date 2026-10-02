/**
 * Рабочий порядок одной задачи.
 * Включается только галкой «Глубокое мышление», это не пресет процесса.
 * Режим шага выбирает кусок: смотреть, план, сборка, сверка.
 * Кто стоит на шаге, по-прежнему решает холст.
 * Сборка получает план. Живой Cursor отсюда не вызывается.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ProjectSnapshot, StepMode, TaskPlan } from '../domain';

export type PieceMode = 'ask' | 'plan' | 'build' | 'review';

const NOTE_MARK = 'Короткая заметка о том, что уже есть.';

export function pieceMode(mode: StepMode): PieceMode | null {
  if (
    mode === 'ask' ||
    mode === 'plan' ||
    mode === 'build' ||
    mode === 'review'
  ) {
    return mode;
  }
  return null;
}

function subject(task: string): string {
  const line = task.trim().split('\n')[0] ?? 'Задача';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function namesOf(project: ProjectSnapshot | null): string[] {
  if (!project?.available) return [];
  const names = [
    ...project.survey,
    ...project.rules,
    ...project.skills,
    ...project.commands,
    ...project.tests,
  ];
  return [...new Set(names)].slice(0, 8);
}

/** Только взгляд на проект: имена путей, без текста файлов и без кода. */
export function lookNote(
  task: string,
  project: ProjectSnapshot | null,
): string {
  const title = subject(task);
  const names = namesOf(project);
  const where = !project?.available
    ? 'Папка проекта не задана, смотрю формулировку задачи.'
    : names.length > 0
      ? `Уже есть: ${names.join(', ')}.`
      : 'В папке проекта на первом уровне пусто.';
  const map =
    project?.mapPath && project.mapText
      ? ` Карта проекта: ${project.mapPath.split(/[\\/]/).pop()}.`
      : '';
  return `${NOTE_MARK} Задача: ${title}. ${where}${map}`;
}

export function draftPlan(task: string): TaskPlan {
  const title = subject(task);
  return {
    why: `Задача «${title}» нужна в рамках текущего проекта.`,
    changes: `Меняется только то, что названо в задаче: ${title}.`,
    how: 'Сборка идёт по чеклисту и берёт в контекст этот план.',
    checklist: [
      '- Заметка остаётся коротким взглядом на проект',
      `- Изменение укладывается в «${title}»`,
      '- Сверка идёт по этому чеклисту',
    ].join('\n'),
  };
}

export function checklistItems(checklist: string): string[] {
  return checklist
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[.)]\s*/, '')
        .trim(),
    )
    .filter(Boolean);
}

export function formatPlan(plan: TaskPlan): string {
  return [
    `Зачем: ${plan.why}`,
    `Что меняется: ${plan.changes}`,
    `Как: ${plan.how}`,
    'Чеклист:',
    plan.checklist.trim(),
  ].join('\n');
}

/** Контекст сборки — только план. Предыдущий диалог сюда не передаётся. */
export function buildFromPlan(plan: TaskPlan): string {
  const items = checklistItems(plan.checklist);
  return [
    'Контекст сборки — план.',
    `Зачем: ${plan.why}`,
    `Что меняется: ${plan.changes}`,
    `Как: ${plan.how}`,
    'По чеклисту:',
    ...items.map((item) => `Сделано: ${item}`),
  ].join('\n');
}

/** Сверка с чеклистом. Текст чата в проверку не входит. */
export function reviewAgainst(plan: TaskPlan, built: string): string {
  const items = checklistItems(plan.checklist);
  const lines = items.map((item) =>
    built.includes(item)
      ? `Есть в результате: ${item}`
      : `Нет в результате: ${item}`,
  );
  const closed = lines.every((line) => line.startsWith('Есть в результате'));
  return [
    'Сверка по чеклисту.',
    ...lines,
    closed ? '## Итог\nЧеклист закрыт.' : '## Итог\nЧеклист не закрыт.',
  ].join('\n');
}

export function archiveResult(built: string, review: string): string {
  return [built, review].filter((part) => part.trim()).join('\n\n');
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
}

/** Папка этой задачи внутри проекта. Без папки проекта части остаются на самой задаче. */
export function taskDirectory(
  project: ProjectSnapshot | null,
  runId: string,
): string | null {
  if (!project?.available || !project.folder) return null;
  if (!/^[\w-]+$/.test(runId)) return null;
  const dir = join(project.folder, '.pipil', 'tasks', runId);
  if (!inside(project.folder, dir)) return null;
  return dir;
}

/** Убирает папку запуска в проекте, если она была создана. */
export function removeTaskDirectory(
  project: ProjectSnapshot | null,
  runId: string,
): void {
  const dir = taskDirectory(project, runId);
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Папку уже могли убрать вручную.
  }
}

export function writeTaskPieces(
  dir: string,
  pieces: { note: string; plan: TaskPlan },
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'заметка.md'), `${pieces.note}\n`, 'utf8');
  writeFileSync(join(dir, 'зачем.md'), `${pieces.plan.why}\n`, 'utf8');
  writeFileSync(join(dir, 'изменения.md'), `${pieces.plan.changes}\n`, 'utf8');
  writeFileSync(join(dir, 'как.md'), `${pieces.plan.how}\n`, 'utf8');
  writeFileSync(join(dir, 'чеклист.md'), `${pieces.plan.checklist}\n`, 'utf8');
}

export function writeTaskArchive(
  dir: string,
  archive: { note: string; plan: TaskPlan; result: string },
): string {
  const folder = join(dir, 'архив');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'заметка.md'), `${archive.note}\n`, 'utf8');
  writeFileSync(join(folder, 'зачем.md'), `${archive.plan.why}\n`, 'utf8');
  writeFileSync(
    join(folder, 'изменения.md'),
    `${archive.plan.changes}\n`,
    'utf8',
  );
  writeFileSync(join(folder, 'как.md'), `${archive.plan.how}\n`, 'utf8');
  writeFileSync(
    join(folder, 'чеклист.md'),
    `${archive.plan.checklist}\n`,
    'utf8',
  );
  writeFileSync(join(folder, 'итог.md'), `${archive.result}\n`, 'utf8');
  return folder;
}
