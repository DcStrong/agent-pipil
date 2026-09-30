import type { Agent, AgentKind, Harness, Run, RunStatus } from './types'

export function statusLabel(status: RunStatus): string {
  if (status === 'running') return 'Выполняется'
  if (status === 'waiting_approval') return 'Ждёт подтверждения'
  if (status === 'waiting_user') return 'Ждёт ответа'
  if (status === 'completed') return 'Готово'
  return 'Ошибка'
}

export function kindLabel(kind: AgentKind): string {
  if (kind === 'orchestrator') return 'Оркестратор'
  if (kind === 'analyst') return 'Аналитик'
  if (kind === 'architect') return 'Архитектор'
  if (kind === 'developer') return 'Бэкенд-разработчик'
  if (kind === 'tester') return 'Тестировщик'
  if (kind === 'planner') return 'Планировщик'
  if (kind === 'builder') return 'Сборщик'
  if (kind === 'reviewer') return 'Ревьюер'
  return 'Свой'
}

export function progress(run: Run): string {
  return `${run.work.length}/${run.steps.length}`
}

export function when(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function taskTitle(task: string): string {
  const line = task.trim().split('\n')[0] ?? 'Задача'
  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

export function finalText(output: string): string {
  const marker = '## Итог'
  const index = output.lastIndexOf(marker)
  if (index === -1) return output.trim()
  const text = output.slice(index + marker.length).trim()
  return text || output.trim()
}

export function harnessLabel(harness: Harness): string {
  return harness === 'cursor' ? 'Cursor' : 'Имитация'
}

/** Имитация всегда «в сети». Cursor — только когда токен сохранён на сервере. */
export function agentOnline(agent: Agent, cursorConnected: boolean): boolean {
  if (agent.harness === 'simulated') return true
  return cursorConnected
}

export function duration(run: Run, now = Date.now()): string {
  const start = new Date(run.createdAt).getTime()
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const sec = Math.max(0, Math.round((end - start) / 1000))
  if (sec < 60) return `${sec} с`
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  return rest === 0 ? `${min} мин` : `${min} мин ${rest} с`
}

export function eventTag(kind: Run['events'][number]['kind']): string {
  if (kind === 'progress') return 'прогресс'
  if (kind === 'handoff') return 'передача'
  if (kind === 'approval') return 'проверка'
  if (kind === 'question') return 'вопрос'
  if (kind === 'done') return 'готово'
  return 'ошибка'
}
