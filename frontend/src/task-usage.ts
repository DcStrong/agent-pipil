import type { RunUsageState } from './types'

export const TASK_USAGE_UNKNOWN = 'Расход пока неизвестен'

export function resolveTaskUsage(
  runUsage: RunUsageState | undefined,
  taskUsage: RunUsageState | undefined,
): RunUsageState | undefined {
  return runUsage ?? taskUsage
}

export function taskUsageKnown(state: RunUsageState | undefined): boolean {
  return state?.known === true && state.totals !== null
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

export function formatChargedUsd(chargedCents: number | null | undefined): string | null {
  if (chargedCents === null || chargedCents === undefined) return null
  return `$${(chargedCents / 100).toFixed(2)}`
}

export function formatTaskUsageBrief(state: RunUsageState | undefined): string {
  if (!taskUsageKnown(state) || !state?.totals) return TASK_USAGE_UNKNOWN
  const { totalTokens, chargedCents } = state.totals
  const cost = formatChargedUsd(chargedCents)
  const tokens = `${formatTokenCount(totalTokens)} токенов`
  return cost ? `${tokens} · ${cost}` : tokens
}

export function formatTaskUsageDetail(state: RunUsageState): string[] {
  if (!taskUsageKnown(state) || !state.totals) return [TASK_USAGE_UNKNOWN]
  const t = state.totals
  const lines = [
    `Входные: ${t.inputTokens.toLocaleString('ru-RU')}`,
    `Выходные: ${t.outputTokens.toLocaleString('ru-RU')}`,
    `Кэш (чтение): ${t.cacheReadTokens.toLocaleString('ru-RU')}`,
    `Кэш (запись): ${t.cacheWriteTokens.toLocaleString('ru-RU')}`,
    `Всего токенов: ${t.totalTokens.toLocaleString('ru-RU')}`,
  ]
  const cost = formatChargedUsd(t.chargedCents)
  if (cost) lines.push(`Стоимость: ${cost}`)
  return lines
}
