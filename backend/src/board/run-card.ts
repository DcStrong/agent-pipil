import type { Run } from '../domain';
import type { BoardActivity, BoardTask } from './model';

const OPEN_RUN = new Set<Run['status']>([
  'running',
  'waiting_approval',
  'waiting_user',
  'waiting_plan',
  'waiting_access',
]);

/** Колонка и заметки карточки повторяют живой запуск, а не таймер имитации. */
export function applyRunToTask(task: BoardTask, run: Run): void {
  if (task.status === 'completed' || task.activity.length === 0) return;
  const now = new Date().toISOString();
  if (run.status === 'completed') {
    task.status = 'review';
    task.phase = 'done';
    task.activity = notesFromRun(task.activity, run);
    task.updatedAt = now;
    return;
  }
  if (
    run.status === 'failed' ||
    run.status === 'interrupted' ||
    OPEN_RUN.has(run.status)
  ) {
    task.status = 'in_progress';
    task.phase = 'working';
    task.activity = notesFromRun(task.activity, run);
    task.updatedAt = now;
  }
}

function notesFromRun(activity: BoardActivity[], run: Run): BoardActivity[] {
  const current = run.stepIndex != null ? run.steps[run.stepIndex] : undefined;
  return activity.map((item) => {
    const finished = run.work.filter((piece) => piece.agentId === item.agentId);
    if (
      (run.status === 'failed' || run.status === 'interrupted') &&
      current?.agentId === item.agentId
    ) {
      return {
        ...item,
        state: 'working',
        note: clip(run.error ?? 'Шаг остановился с ошибкой.'),
      };
    }
    if (OPEN_RUN.has(run.status) && current?.agentId === item.agentId) {
      const live = [...current.messages]
        .reverse()
        .find((message) => message.text.trim());
      return {
        ...item,
        state: 'working',
        note: clip(live?.text ?? `Ведёт «${current.title}».`),
      };
    }
    if (finished.length > 0) {
      const last = finished[finished.length - 1];
      return {
        ...item,
        state: 'done',
        note: clip(last.summary || last.output || 'Шаг пройден.'),
      };
    }
    if (run.status === 'completed') {
      return {
        ...item,
        state: 'done',
        note: clip(item.note || 'Шаг пройден.'),
      };
    }
    return {
      ...item,
      state: 'waiting',
      note: 'Ждёт своей очереди.',
    };
  });
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 177)}…`;
}
