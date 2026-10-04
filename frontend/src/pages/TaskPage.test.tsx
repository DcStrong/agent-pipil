/** Экран задачи на проверке: сводки и действия владельца. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardTask, Run } from '../types'
import { TaskPage } from './TaskPage'

const harness = vi.hoisted(() => ({
  live: null as unknown,
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  answerTask: vi.fn(),
}))

vi.mock('../live', () => ({
  useLive: () => harness.live,
}))

vi.mock('../api', () => ({
  api: {
    completeTask: (...args: unknown[]) => harness.completeTask(...args),
    reopenTask: (...args: unknown[]) => harness.reopenTask(...args),
    answerTask: (...args: unknown[]) => harness.answerTask(...args),
  },
  messageOf: (error: unknown) => (error instanceof Error ? error.message : 'ошибка'),
}))

const usageKnown = {
  known: true,
  totals: {
    inputTokens: 1200,
    outputTokens: 800,
    cacheReadTokens: 100,
    cacheWriteTokens: 50,
    totalTokens: 2150,
    chargedCents: 33,
  },
}

const reviewTask: BoardTask = {
  id: 't1',
  title: 'Сводка',
  description: 'Текст задачи',
  status: 'review',
  projectId: 'p1',
  projectLabel: 'Проект',
  workflowId: null,
  workflowName: null,
  runId: 'run1',
  team: [{ agentId: 'role_analyst', mode: 'ask' }],
  phase: 'done',
  activity: [
    {
      agentId: 'role_analyst',
      agentName: 'Аналитик',
      mode: 'ask',
      state: 'done',
      note: 'total в списках планов снова считается через COUNT.',
    },
  ],
  plan: null,
  createdAt: '',
  updatedAt: '',
}

const run: Run = {
  id: 'run1',
  workflowId: 'wf',
  workflowName: 'Процесс',
  task: 'Сводка',
  status: 'waiting_user',
  stepIndex: 0,
  steps: [],
  work: [],
  events: [],
  finalResult: null,
  error: null,
  createdAt: '',
  updatedAt: '',
  finishedAt: null,
  project: null,
  developerShape: 'none',
  pendingQuestion: 'Какой формат ответа нужен?',
  mapWritten: false,
  mapNote: null,
  deepThinking: false,
  note: null,
  plan: null,
  buildText: null,
  reviewText: null,
  taskFolder: null,
  archive: null,
  cliChatId: null,
}

function liveState() {
  return {
    ready: true,
    tasks: [reviewTask],
    runs: [run],
    upsertTask: vi.fn(),
    upsertRun: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  harness.completeTask.mockReset()
  harness.reopenTask.mockReset()
  harness.answerTask.mockReset()
})

describe('TaskPage — проверка', () => {
  it('показывает токены и стоимость, когда usage известен', () => {
    harness.live = {
      ...liveState(),
      runs: [{ ...run, usage: usageKnown }],
    }
    render(<TaskPage taskId="t1" />)
    expect(screen.getByTestId('usage-total').textContent?.replace(/\s/g, '')).toContain('2150')
    expect(screen.getByTestId('usage-cost').textContent).toContain('0.33')
    expect(screen.queryByTestId('usage-unknown')).toBeNull()
  })

  it('пишет «неизвестен», когда usage нет', () => {
    harness.live = liveState()
    render(<TaskPage taskId="t1" />)
    expect(screen.getByTestId('usage-unknown').textContent).toContain('неизвестен')
    expect(screen.queryByTestId('usage-total')).toBeNull()
  })

  it('показывает сводки агентов и действия', () => {
    harness.live = liveState()
    render(<TaskPage taskId="t1" />)
    expect(screen.getByTestId('agent-summaries').textContent).toContain('COUNT')
    expect(screen.getByTestId('review-actions')).toBeTruthy()
    expect(screen.getByTestId('task-question').textContent).toContain('формат ответа')
  })

  it('завершает задачу с экрана проверки', async () => {
    const upsertTask = vi.fn()
    harness.live = { ...liveState(), upsertTask }
    harness.completeTask.mockResolvedValue({ ...reviewTask, status: 'completed' })
    render(<TaskPage taskId="t1" />)
    fireEvent.click(screen.getByTestId('complete-task'))
    await waitFor(() => expect(harness.completeTask).toHaveBeenCalledWith('t1'))
    expect(upsertTask).toHaveBeenCalled()
  })

  it('возвращает в работу с дополнением', async () => {
    harness.live = liveState()
    harness.reopenTask.mockResolvedValue({ ...reviewTask, status: 'in_progress' })
    render(<TaskPage taskId="t1" />)
    fireEvent.change(screen.getByTestId('reopen-note'), {
      target: { value: 'Добавить тесты' },
    })
    fireEvent.click(screen.getByTestId('reopen-task'))
    await waitFor(() =>
      expect(harness.reopenTask).toHaveBeenCalledWith('t1', 'Добавить тесты'),
    )
  })

  it('отправляет ответ на вопрос агента', async () => {
    const upsertTask = vi.fn()
    const upsertRun = vi.fn()
    harness.live = { ...liveState(), upsertTask, upsertRun }
    harness.answerTask.mockResolvedValue({
      task: reviewTask,
      run: { ...run, status: 'running', pendingQuestion: null },
    })
    render(<TaskPage taskId="t1" />)
    fireEvent.change(screen.getByTestId('task-answer'), { target: { value: 'JSON объект' } })
    fireEvent.click(screen.getByTestId('task-send-answer'))
    await waitFor(() => expect(harness.answerTask).toHaveBeenCalledWith('t1', 'JSON объект'))
    expect(upsertRun).toHaveBeenCalled()
  })
})
