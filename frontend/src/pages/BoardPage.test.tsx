/** Форма новой задачи: проект обязателен, нужны агенты или процесс. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api } from '../api'
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
    pickProjectPath: vi.fn(),
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

  it('без вложенной form: подсказка и кнопки исполнителей не ломают разметку', () => {
    harness.live = liveState()
    const { container } = render(<BoardPage />)
    fireEvent.click(screen.getByTestId('new-task'))
    fireEvent.click(screen.getByTestId('toggle-add-project'))
    expect(container.querySelector('form.compose form')).toBeNull()
    const team = container.querySelector('#compose-team')?.closest('.team-pick')
    expect(team).not.toBeNull()
    const hint = within(team as HTMLElement).getByText(/Либо отдельные агенты/)
    const addAgent = within(team as HTMLElement).getByTestId('add-agent')
    expect(hint.compareDocumentPosition(addAgent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('кнопка «Выбрать» подставляет путь в поле проекта', async () => {
    harness.live = { ...liveState(), projects: [] }
    vi.mocked(api.pickProjectPath).mockResolvedValue({ path: '/home/user/proj' })
    render(<BoardPage />)
    fireEvent.click(screen.getByTestId('new-task'))
    fireEvent.click(screen.getByTestId('toggle-add-project'))
    fireEvent.click(screen.getByTestId('inline-pick-project-path'))
    await waitFor(() =>
      expect((screen.getByTestId('inline-project-path') as HTMLInputElement).value).toBe(
        '/home/user/proj',
      ),
    )
    expect(api.pickProjectPath).toHaveBeenCalledWith({ kind: 'folder' })
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
