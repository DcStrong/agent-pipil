import { describe, expect, it } from 'vitest'
import {
  formatTaskUsageBrief,
  taskUsageKnown,
  TASK_USAGE_UNKNOWN,
} from './task-usage'

describe('task-usage', () => {
  it('неизвестный расход без нулей', () => {
    expect(taskUsageKnown(undefined)).toBe(false)
    expect(formatTaskUsageBrief(undefined)).toBe(TASK_USAGE_UNKNOWN)
  })

  it('краткая сводка с токенами и ценой', () => {
    const text = formatTaskUsageBrief({
      known: true,
      totals: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1500,
        chargedCents: 42,
      },
    })
    expect(text).toContain('1.5k')
    expect(text).toContain('$0.42')
  })
})
