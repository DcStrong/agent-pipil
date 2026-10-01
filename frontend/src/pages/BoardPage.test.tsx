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

  it('сохранение проекта с формы выбирает его для задачи', async () => {
    const projects: (typeof liveState)['projects'] = []
    const upsertProject = vi.fn((project: (typeof projects)[number]) => {
      projects.push(project)
    })
    harness.live = { ...liveState(), projects, upsertProject }
    vi.mocked(api.addProject).mockResolvedValue({
      id: 'p-new',
      kind: 'folder',
      path: '/Users/dc_strong/myProject',
      folderName: 'myProject',
      alias: '',
      label: 'myProject',
    })
    vi.mocked(api.updateProjectAlias).mockResolvedValue({
      id: 'p-new',
      kind: 'folder',
      path: '/Users/dc_strong/myProject',
      folderName: 'myProject',
      alias: '123',
      label: '123',
    })
    harness.createTask.mockResolvedValue({
      id: 't1',
      title: 'test',
      description: '123',
      status: 'new',
      projectId: 'p-new',
      projectLabel: '123',
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
    fireEvent.change(screen.getByTestId('task-title'), { target: { value: 'test' } })
    fireEvent.click(screen.getByTestId('toggle-add-project'))
    fireEvent.change(screen.getByTestId('inline-project-path'), {
      target: { value: '/Users/dc_strong/myProject' },
    })
    fireEvent.change(screen.getByTestId('inline-project-alias'), { target: { value: '123' } })
    fireEvent.click(screen.getByTestId('save-inline-project'))
    await waitFor(() => expect(upsertProject).toHaveBeenCalled())
    expect(screen.getByTestId('task-project-label').textContent).toContain('123')
    fireEvent.click(screen.getByTestId('add-agent'))
    fireEvent.click(screen.getByText('Аналитик'))
    fireEvent.click(screen.getByTestId('create-task'))
    await waitFor(() => expect(harness.createTask).toHaveBeenCalled())
    expect(harness.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-new' }),
    )
  })

  it('ошибка сохранения проекта показывается рядом с кнопкой', async () => {
    harness.live = { ...liveState(), projects: [] }
    vi.mocked(api.addProject).mockRejectedValue(new Error('Путь не найден'))
    render(<BoardPage />)
    fireEvent.click(screen.getByTestId('new-task'))
    fireEvent.click(screen.getByTestId('toggle-add-project'))
    fireEvent.change(screen.getByTestId('inline-project-path'), {
      target: { value: '/missing/path' },
    })
    fireEvent.click(screen.getByTestId('save-inline-project'))
    await waitFor(() =>
      expect(screen.getByTestId('inline-project-save-error').textContent).toContain('Путь не найден'),
    )
    expect(screen.queryByTestId('board-form-error')).toBeNull()
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
