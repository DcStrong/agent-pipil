/** На экране «Процессы» свой пресет убирается из сетки; процесс удаляется целиком по кнопке «Удалить». */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKind, PipelinePreset, Run, Workflow } from '../types'
import { WorkflowsPage } from './WorkflowsPage'

const harness = vi.hoisted(() => ({
  live: null as unknown,
  deletePreset: vi.fn(),
  deleteWorkflow: vi.fn(),
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
      deleteWorkflow: (...args: Parameters<typeof actual.api.deleteWorkflow>) => harness.deleteWorkflow(...args),
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

const sampleWorkflow: Workflow = {
  id: 'workflow_custom_1',
  name: 'Мой процесс',
  description: 'Описание',
  steps: [{ id: 'step_1', agentId: 'agent_1', title: 'Шаг', mode: 'automatic', handoff: '', nextIds: [] }],
}

function mountWorkflows(workflows: Workflow[], runs: Run[] = []) {
  let currentWorkflows = workflows
  const removeWorkflow = vi.fn((id: string) => {
    currentWorkflows = currentWorkflows.filter((item) => item.id !== id)
    harness.live = { ...harness.live, workflows: currentWorkflows }
  })
  harness.live = {
    ready: true,
    error: null,
    workflows: currentWorkflows,
    agents: [],
    runs,
    cursor: { connected: false, source: 'none', hint: null },
    presets: [],
    upsertWorkflow: vi.fn(),
    removeWorkflow,
  }
  const view = render(<WorkflowsPage />)
  return {
    removeWorkflow,
    sync() {
      harness.live = { ...harness.live, workflows: currentWorkflows }
      view.rerender(<WorkflowsPage />)
    },
  }
}

beforeEach(() => {
  harness.deletePreset.mockReset()
  harness.deleteWorkflow.mockReset()
  harness.openPreset.mockReset()
  harness.deletePreset.mockResolvedValue({ ok: true })
  harness.deleteWorkflow.mockResolvedValue({ ok: true })
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

describe('Процессы: удаление из списка', () => {
  it('убирает процесс из списка по кнопке «Удалить»', async () => {
    const { removeWorkflow, sync } = mountWorkflows([sampleWorkflow])
    expect(screen.getByTestId('workflow-tile-workflow_custom_1')).toBeTruthy()
    await press(screen.getByTestId('workflow_custom_1-remove'))
    expect(harness.deleteWorkflow).toHaveBeenCalledWith('workflow_custom_1')
    expect(removeWorkflow).toHaveBeenCalledWith('workflow_custom_1')
    sync()
    expect(screen.queryByTestId('workflow-tile-workflow_custom_1')).toBeNull()
  })

  it('карточка процесса ведёт на холст', () => {
    mountWorkflows([sampleWorkflow])
    const card = screen.getByTestId('workflow-card')
    expect(card.getAttribute('href')).toContain('workflow_custom_1')
  })

  it('при активном запуске показывает причину и не даёт удалить', async () => {
    const activeRun = {
      id: 'run_1',
      workflowId: 'workflow_custom_1',
      workflowName: 'Мой процесс',
      task: 'Задача',
      status: 'running',
      stepIndex: 0,
      steps: [],
      work: [],
      events: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      finalResult: null,
      error: null,
      project: null,
      developerShape: 'text',
      pendingQuestion: null,
      mapWritten: false,
      mapNote: null,
      deepThinking: false,
      note: null,
      plan: null,
      buildText: null,
      reviewText: null,
      taskFolder: null,
      archive: null,
    } satisfies Run
    mountWorkflows([sampleWorkflow], [activeRun])
    expect(screen.queryByTestId('workflow_custom_1-remove')).toBeNull()
    const hint = screen.getByTestId('workflow_custom_1-remove-hint')
    expect(hint.textContent).toContain('активного запуска')
    expect(harness.deleteWorkflow).not.toHaveBeenCalled()
  })

  it('показывает ошибку сервера при неудачном удалении процесса', async () => {
    harness.deleteWorkflow.mockRejectedValueOnce(new Error('Процесс не найден.'))
    mountWorkflows([sampleWorkflow])
    await press(screen.getByTestId('workflow_custom_1-remove'))
    expect(screen.getByText('Процесс не найден.')).toBeTruthy()
    expect(screen.getByTestId('workflow-tile-workflow_custom_1')).toBeTruthy()
  })
})
