/** На экране «Процессы» свой пресет убирается из сетки; встроенный остаётся с причиной. */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKind, PipelinePreset } from '../types'
import { WorkflowsPage } from './WorkflowsPage'

const harness = vi.hoisted(() => ({
  live: null as unknown,
  deletePreset: vi.fn(),
  openPreset: vi.fn(),
}))

vi.mock('../live', () => ({
  useLive: () => harness.live,
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      deletePreset: (...args: Parameters<typeof actual.api.deletePreset>) => harness.deletePreset(...args),
      openPreset: (...args: Parameters<typeof actual.api.openPreset>) => harness.openPreset(...args),
    },
  }
})

function step(title: string, kind: AgentKind = 'developer') {
  return {
    key: title,
    agentId: null,
    kind,
    title,
    mode: 'automatic' as const,
    handoff: '',
    nextKeys: [] as string[],
  }
}

const builtin: PipelinePreset = {
  id: 'preset_feature',
  name: 'Новая фича',
  description: '',
  builtin: true,
  steps: [step('Анализ', 'analyst'), step('Разработка', 'developer')],
}

const custom: PipelinePreset = {
  id: 'preset_custom_1',
  name: 'Моя ветка',
  description: '',
  builtin: false,
  steps: [step('Сборка', 'orchestrator')],
}

function mount(presets: PipelinePreset[]) {
  let currentPresets = presets
  const removePreset = vi.fn((id: string) => {
    currentPresets = currentPresets.filter((item) => item.id !== id)
    harness.live = { ...harness.live, presets: currentPresets }
  })
  harness.live = {
    ready: true,
    error: null,
    workflows: [],
    agents: [],
    runs: [],
    cursor: { connected: false, source: 'none', hint: null },
    presets: currentPresets,
    upsertWorkflow: vi.fn(),
    removePreset,
  }
  const view = render(<WorkflowsPage />)
  return {
    removePreset,
    sync() {
      harness.live = { ...harness.live, presets: currentPresets }
      view.rerender(<WorkflowsPage />)
    },
  }
}

async function press(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

beforeEach(() => {
  harness.deletePreset.mockReset()
  harness.openPreset.mockReset()
  harness.deletePreset.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  harness.live = null
})

describe('Процессы: пресеты в сетке', () => {
  it('убирает свой пресет из сетки по кнопке «Убрать»', async () => {
    const { removePreset, sync } = mount([builtin, custom])
    expect(screen.getByTestId('preset-tile-preset_custom_1')).toBeTruthy()
    await press(screen.getByTestId('preset_custom_1-remove'))
    expect(harness.deletePreset).toHaveBeenCalledWith('preset_custom_1')
    expect(removePreset).toHaveBeenCalledWith('preset_custom_1')
    sync()
    expect(screen.queryByTestId('preset-tile-preset_custom_1')).toBeNull()
    expect(screen.getByTestId('preset-tile-preset_feature')).toBeTruthy()
  })

  it('для встроенного пресета показывает причину и не даёт убрать', async () => {
    mount([builtin])
    expect(screen.queryByTestId('preset_feature-remove')).toBeNull()
    const hint = screen.getByTestId('preset_feature-remove-hint')
    expect(hint.textContent).toContain('Встроенный пресет убрать нельзя')
    const tile = screen.getByTestId('preset-tile-preset_feature')
    expect(within(tile).queryByRole('button', { name: 'Убрать' })).toBeNull()
  })

  it('показывает ошибку сервера при неудачном удалении', async () => {
    harness.deletePreset.mockRejectedValueOnce(new Error('Сервер недоступен.'))
    mount([custom])
    await press(screen.getByTestId('preset_custom_1-remove'))
    expect(screen.getByText('Сервер недоступен.')).toBeTruthy()
    expect(screen.getByTestId('preset-tile-preset_custom_1')).toBeTruthy()
  })
})
