/** Подписи доски. Значения статусов в данных не переводятся. */
import type { AgentKind, BoardPhase, MemberState, WorkMode } from './types'

export function defaultWorkMode(kind: AgentKind): WorkMode {
  if (kind === 'architect' || kind === 'planner') return 'plan'
  if (kind === 'developer' || kind === 'builder' || kind === 'reviewer') return 'agent'
  return 'ask'
}

export function modeLabel(mode: WorkMode): string {
  if (mode === 'ask') return 'Вопрос'
  if (mode === 'plan') return 'План'
  return 'Агент'
}

export function memberStateLabel(state: MemberState): string {
  if (state === 'working') return 'Работает'
  if (state === 'waiting') return 'Ждёт сборку'
  return 'Готово'
}

export function columnLabel(status: 'new' | 'in_progress' | 'review'): string {
  if (status === 'new') return 'Новые'
  if (status === 'in_progress') return 'В работе'
  return 'На проверке'
}

/** Какой шаг порядка плана сейчас подсвечен. Вопрос этот порядок не занимает. */
export function planStep(phase: BoardPhase): number {
  if (phase === 'build') return 1
  if (phase === 'done') return 2
  if (phase === 'plan' || phase === 'working') return 0
  return -1
}
