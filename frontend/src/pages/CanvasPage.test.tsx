/**
 * «Следом» и «Ответвить» меняют дерево; шаг убирается без обрыва связей.
 * У ролей нет флажков «в конец списка» — только «Ещё» и блок «Следом».
 * Занятый холст в той же части панели объясняет, почему кнопки не работают.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentKind, Run, RunStatus, Workflow } from '../types'
import { CanvasPage } from './CanvasPage'

const harness = vi.hoisted(() => ({
  live: null as unknown,
}))

vi.mock('../live', () => ({
  useLive: () => harness.live,
}))

const TASK = 'Нужен массив объектов заказов'

function agent(id: string, name: string, kind: AgentKind): Agent {
  return { id, name, kind, instructions: '', harness: 'simulated' }
}

const agents: Agent[] = [
  agent('agent-orch', 'Оркестратор', 'orchestrator'),
  agent('agent-dev', 'Бэкенд-разработчик', 'developer'),
  agent('agent-test', 'Тестировщик', 'tester'),
]

const workflow: Workflow = {
  id: 'wf-1',
  name: 'Сборка с проверкой',
  description: 'Проверка перед сборкой',
  steps: [
    {
      id: 'step-a',
      agentId: 'agent-orch',
      title: 'Сборка',
      mode: 'automatic',
      handoff: 'Передай результат следующему шагу.',
      nextIds: ['step-b'],
    },
    {
      id: 'step-b',
      agentId: 'agent-dev',
      title: 'Проверка',
      mode: 'approval',
      handoff: '',
      nextIds: [],
    },
  ],
}

function makeRun(status: RunStatus): Run {
  const open =
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'waiting_user' ||
    status === 'waiting_plan'
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowName: workflow.name,
    task: TASK,
    status,
    stepIndex: 0,
    steps: [],
    work: [],
    events: [],
    finalResult: null,
    error: status === 'failed' ? 'Владелец отклонил вопрос.' : null,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    finishedAt: open ? null : '2026-10-01T08:01:00.000Z',
    project: null,
    developerShape: 'none',
    pendingQuestion: status === 'waiting_user' ? 'Какой массив нужен?' : null,
    mapWritten: false,
    mapNote: null,
    deepThinking: false,
    note: null,
    plan: null,
    buildText: null,
    reviewText: null,
    taskFolder: null,
    archive: null,
  }
}

function titles(): string[] {
  return [...screen.getByTestId('canvas').querySelectorAll('.node-title')].map((node) => node.textContent ?? '')
}

function depth(title: string): number {
  const canvas = screen.getByTestId('canvas')
  const node = [...canvas.querySelectorAll('.node-title')].find((item) => item.textContent === title)
  if (!node) throw new Error(`На холсте нет шага «${title}».`)
  let level = 0
  let current = node.parentElement
  while (current && current !== canvas) {
    if (current.classList.contains('kids')) level += 1
    current = current.parentElement
  }
  return level
}

function assertReason(panel: HTMLElement) {
  const notice = within(panel).queryByTestId('canvas-busy')
  if (!notice) {
    throw new Error(
      'Щелчок ничего не изменил, а в этой части панели нет причины: процесс занят, имя задачи, Открыть, Продолжить, Остановить.',
    )
  }
  expect(notice.textContent).toContain('Процесс занят')
  expect(notice.textContent).toContain(TASK)
  expect(within(notice).getByRole('link', { name: 'Открыть' }).getAttribute('href')).toBe('#/run/run-1')
  expect(within(notice).getByRole('button', { name: 'Продолжить' })).toBeTruthy()
  expect(within(notice).getByRole('button', { name: 'Остановить' })).toBeTruthy()
}

async function press(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

async function open(runs: Run[]) {
  harness.live = {
    ready: true,
    error: null,
    agents,
    skills: [],
    workflows: [workflow],
    presets: [],
    runs,
    tasks: [],
    cursor: { connected: false, source: 'none', hint: null },
    reload: async () => undefined,
    upsertRun: () => undefined,
    upsertTask: () => undefined,
    upsertWorkflow: () => undefined,
    upsertPreset: () => undefined,
    removePreset: () => undefined,
  }
  render(<CanvasPage workflowId={workflow.id} />)
  await screen.findByTestId('canvas')
}

afterEach(() => {
  cleanup()
  harness.live = null
})

describe('Холст: роли, «Следом», «Ответвить» и уборка шага', () => {
  it('не показывает поле задачи и кнопку «Запустить» — запуск только с доски', async () => {
    await open([])
    expect(screen.queryByTestId('task-input')).toBeNull()
    expect(screen.queryByTestId('start-run')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Запустить' })).toBeNull()
    expect(screen.getByTestId('canvas-config-hint').textContent).toContain('доске')
  })

  it('в блоке ролей нет флажков добавления в конец списка', async () => {
    await open([])
    const roles = screen.getByTestId('roles-panel')
    expect(within(roles).queryByRole('checkbox')).toBeNull()
    expect(screen.queryByTestId('role-tester')).toBeNull()
  })

  it('без crypto.randomUUID «Следом» и «Ответвить» меняют дерево', async () => {
    const saved = globalThis.crypto.randomUUID
    Reflect.deleteProperty(globalThis.crypto, 'randomUUID')
    try {
      await open([])
      await press(screen.getByTestId('place-next'))
      expect(titles()).toEqual(['Сборка', 'Оркестратор', 'Проверка'])

      cleanup()
      harness.live = null
      await open([])
      await press(screen.getByTestId('place-branch'))
      expect(titles()).toEqual(['Сборка', 'Проверка', 'Оркестратор'])
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: saved,
      })
    }
  })

  it('без запуска «Следом» вставляет шаг в цепочку выбранного', async () => {
    await open([])
    await press(screen.getByTestId('place-next'))
    expect(titles()).toEqual(['Сборка', 'Оркестратор', 'Проверка'])
    expect(screen.getByTestId('canvas').querySelector('.kids.many')).toBeNull()
    expect(depth('Проверка')).toBe(2)
  })

  it('без запуска «Ответвить» ведёт вторую ветку от выбранного', async () => {
    await open([])
    await press(screen.getByTestId('place-branch'))
    expect(titles()).toEqual(['Сборка', 'Проверка', 'Оркестратор'])
    expect(screen.getByTestId('canvas').querySelector('.kids.many')).not.toBeNull()
    expect(depth('Проверка')).toBe(1)
    expect(depth('Оркестратор')).toBe(1)
  })

  it('убирает выбранный шаг и сохраняет цепочку', async () => {
    await open([])
    await press(screen.getByTestId('step-step-b'))
    await press(screen.getByTestId('remove-step'))
    expect(titles()).toEqual(['Сборка'])
    expect(screen.getByTestId('remove-step-reason').textContent).toContain('хотя бы один шаг')
  })

  it('занятый холст не молчит у ролей, «Следом» и «Ответвить»', async () => {
    await open([makeRun('waiting_user')])
    const before = titles().join('|')
    const cases = [
      ['roles-panel', 'role-more-tester'],
      ['place-panel', 'place-next'],
      ['place-panel', 'place-branch'],
    ] as const
    for (const [panelId, controlId] of cases) {
      const panel = screen.getByTestId(panelId)
      await press(within(panel).getByTestId(controlId))
      const after = titles().join('|')
      if (after !== before) throw new Error(`${controlId} изменил дерево, пока запуск ещё открыт.`)
      assertReason(panel)
    }
  })

  it('отказ от вопроса не держит холст занятым', async () => {
    await open([makeRun('failed')])
    expect(screen.queryByTestId('canvas-busy')).toBeNull()
    await press(screen.getByTestId('role-more-tester'))
    expect(titles()).toEqual(['Сборка', 'Тестировщик', 'Проверка'])
  })
})
