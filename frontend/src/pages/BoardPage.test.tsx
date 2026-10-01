/** Форма новой задачи: проект обязателен, нужны агенты или процесс. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent, BoardTask } from '../types'
import { BoardPage } from './BoardPage'

const harness = vi.hoisted(() => ({
  live: null as unknown,
  createTask: vi.fn(),
}))

vi.mock('../live', () => ({
  useLive: () => harness.live,
}))

vi.mock('../api', () => ({
  api: {
    createTask: (...args: unknown[]) => harness.createTask(...args),
    moveTask: vi.fn(),
    addProject: vi.fn(),
    updateProjectAlias: vi.fn(),
  },
  messageOf: (error: unknown) => (error instanceof Error ? error.message : 'ошибка'),
}))

const agents: Agent[] = [
  {
    id: 'role_analyst',
    name: 'Аналитик',
    kind: 'analyst',
    instructions: '',
    harness: 'simulated',
  },
]

function liveState() {
  return {
    ready: true,
    error: null,
    agents,
    workflows: [],
    projects: [
      {
        id: 'p1',
        kind: 'folder' as const,
        path: '/tmp/x',
        folderName: 'x',
        alias: '',
        label: 'Мой проект',
      },
    ],
    tasks: [] as BoardTask[],
    upsertTask: vi.fn(),
    upsertProject: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  harness.createTask.mockReset()
})

describe('BoardPage — новая задача', () => {
  it('без проекта пишет, чего не хватает', () => {
    harness.live = liveState()
    render(<BoardPage />)
    fireEvent.click(screen.getByTestId('new-task'))
    fireEvent.change(screen.getByTestId('task-title'), { target: { value: 'Задача' } })
    fireEvent.click(screen.getByTestId('create-task'))
    expect(screen.getByTestId('board-form-error').textContent).toContain('проект')
    expect(harness.createTask).not.toHaveBeenCalled()
  })

  it('с проектом и агентом создаёт задачу', async () => {
    harness.live = liveState()
    harness.createTask.mockResolvedValue({
      id: 't1',
      title: 'Задача',
      description: '',
      status: 'new',
      projectId: 'p1',
      projectLabel: 'Мой проект',
      workflowId: null,
      workflowName: null,
      team: [{ agentId: 'role_analyst', mode: 'ask' }],
      phase: 'idle',
      activity: [],
      plan: null,
      createdAt: '',
      updatedAt: '',
    })
    render(<BoardPage />)
    fireEvent.click(screen.getByTestId('new-task'))
    fireEvent.change(screen.getByTestId('task-title'), { target: { value: 'Задача' } })
    fireEvent.click(screen.getByTestId('task-project'))
    fireEvent.click(screen.getByRole('option', { name: 'Мой проект (папка)' }))
    fireEvent.click(screen.getByTestId('add-agent'))
    fireEvent.click(screen.getByText('Аналитик'))
    fireEvent.click(screen.getByTestId('create-task'))
    await waitFor(() => expect(harness.createTask).toHaveBeenCalled())
    expect(harness.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Задача',
        projectId: 'p1',
        team: [{ agentId: 'role_analyst', mode: 'ask' }],
      }),
    )
  })
})
