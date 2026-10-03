/** Доска из трёх колонок. Перенос в работу запускает выбранную команду. */
import { useRef, useState, type FormEvent, type DragEvent, type MouseEvent } from 'react'
import { api, messageOf } from '../api'
import { columnLabel, defaultWorkMode, memberStateLabel, modeLabel } from '../board'
import { DarkSelect } from '../components/DarkSelect'
import { ProjectPathInput } from '../components/ProjectPathInput'
import { IconPlus } from '../components/Icons'
import { useLive } from '../live'
import { href } from '../route'
import type { Agent, BoardStatus, BoardTask, SavedProjectKind, WorkMode, Workflow } from '../types'

const COLUMNS: BoardStatus[] = ['new', 'in_progress', 'review']

type PickedAgent = { agentId: string; mode: WorkMode }

export function BoardPage() {
  const {
    ready,
    error: loadError,
    agents,
    workflows,
    projects,
    tasks,
    runs,
    upsertTask,
    upsertProject,
    removeTask,
    removeRun,
  } = useLive()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  const [pickedAgents, setPickedAgents] = useState<PickedAgent[]>([])
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [processPickerOpen, setProcessPickerOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [newProjectKind, setNewProjectKind] = useState<SavedProjectKind>('folder')
  const [newProjectPath, setNewProjectPath] = useState('')
  const [newProjectAlias, setNewProjectAlias] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState<BoardStatus | null>(null)

  const selectedWorkflow = workflows.find((item) => item.id === workflowId) ?? null
  const selectedProject = projects.find((item) => item.id === projectId) ?? null

  function validate(): string | null {
    if (!title.trim()) return 'Напишите название задачи.'
    if (!projectId) return 'Выберите проект или workspace.'
    if (!workflowId && pickedAgents.length === 0) {
      return 'Добавьте агентов или выберите процесс.'
    }
    return null
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const task = await api.createTask({
        title,
        description,
        projectId,
        team: workflowId ? undefined : pickedAgents,
        workflowId: workflowId ?? undefined,
      })
      upsertTask(task)
      setTitle('')
      setDescription('')
      setPickedAgents([])
      setWorkflowId(null)
      setCreating(false)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function addProjectFromForm() {
    setBusy(true)
    setProjectSaveError(null)
    try {
      const created = await api.addProject({ kind: newProjectKind, path: newProjectPath })
      let saved = created
      if (newProjectAlias.trim()) {
        try {
          saved = await api.updateProjectAlias(created.id, newProjectAlias)
        } catch (reason) {
          setProjectSaveError(
            `Проект сохранён, но алиас не записался: ${messageOf(reason)}`,
          )
        }
      }
      upsertProject(saved)
      setProjectId(saved.id)
      setError(null)
      setNewProjectPath('')
      setNewProjectAlias('')
      setAddProjectOpen(false)
    } catch (reason) {
      setProjectSaveError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  function addAgent(agent: Agent) {
    if (pickedAgents.some((item) => item.agentId === agent.id)) return
    setWorkflowId(null)
    setPickedAgents((list) => [...list, { agentId: agent.id, mode: defaultWorkMode(agent.kind) }])
    setAgentPickerOpen(false)
  }

  function removeAgent(agentId: string) {
    setPickedAgents((list) => list.filter((item) => item.agentId !== agentId))
  }

  function chooseWorkflow(workflow: Workflow) {
    setPickedAgents([])
    setWorkflowId(workflow.id)
    setProcessPickerOpen(false)
  }

  async function move(id: string, status: BoardStatus) {
    const task = tasks.find((item) => item.id === id)
    if (!task || task.status === status) return
    setError(null)
    try {
      upsertTask(await api.moveTask(id, status))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function dropTask(task: BoardTask) {
    if (
      !window.confirm(
        `Удалить задачу «${task.title}» и все её запуски? Это нельзя отменить.`,
      )
    ) {
      return
    }
    setError(null)
    try {
      await api.deleteTask(task.id)
      removeTask(task.id)
      for (const run of runs) {
        if (run.id === task.runId || run.boardTaskId === task.id) {
          removeRun(run.id)
        }
      }
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  function onDrop(status: BoardStatus, event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setOver(null)
    const id = event.dataTransfer.getData('text/plain')
    if (id) void move(id, status)
  }

  const agentMap = new Map(agents.map((agent) => [agent.id, agent]))
  const availableAgents = agents.filter(
    (agent) => !pickedAgents.some((item) => item.agentId === agent.id),
  )

  return (
    <div className="board-page">
      <header className="board-head">
        <div>
          <h1>Доска</h1>
          <p className="hint board-hint">
            Новая задача ждёт в первой колонке. В работе её берёт выбранная команда или процесс. На проверку она
            переходит сама, когда ход закончен.
          </p>
        </div>
        <button type="button" className="primary" data-testid="new-task" onClick={() => setCreating((value) => !value)}>
          <IconPlus />
          Новая задача
        </button>
      </header>
      {loadError ? <p className="banner">{loadError}</p> : null}
      {error ? <p className="banner" data-testid="board-form-error">{error}</p> : null}
      {!ready && !loadError ? <p className="muted">Загрузка…</p> : null}
      {creating ? (
        <form className="card compose" onSubmit={(event) => void create(event)}>
          <label className="field">
            <span>Название</span>
            <input data-testid="task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>Описание</span>
            <textarea
              data-testid="task-body"
              value={description}
              placeholder="Что нужно сделать"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <section className="team-pick" aria-labelledby="compose-project">
            <h3 id="compose-project" className="team-pick-title">
              Проект
            </h3>
            {projects.length > 0 ? (
              <DarkSelect
                testId="task-project"
                value={projectId}
                options={[
                  { value: '', label: '— выберите проект или workspace —' },
                  ...projects.map((item) => ({
                    value: item.id,
                    label: `${item.label} (${item.kind === 'workspace' ? 'workspace' : 'папка'})`,
                  })),
                ]}
                onChange={setProjectId}
              />
            ) : (
              <p className="hint">Сохранённых проектов пока нет — добавьте ниже.</p>
            )}
            {selectedProject ? (
              <p className="where" data-testid="task-project-label">
                Задача для: {selectedProject.label} ·{' '}
                {selectedProject.kind === 'workspace' ? 'workspace' : 'папка'} {selectedProject.folderName}
              </p>
            ) : null}
            <button
              type="button"
              className="text-btn"
              data-testid="toggle-add-project"
              onClick={() => {
                setAddProjectOpen((value) => !value)
                setProjectSaveError(null)
              }}
            >
              {addProjectOpen ? 'Скрыть добавление проекта' : 'Добавить новый проект или workspace'}
            </button>
            {addProjectOpen ? (
              <div className="inline-add-project" data-testid="inline-add-project">
                <label className="field">
                  <span>Тип</span>
                  <select
                    value={newProjectKind}
                    onChange={(event) => setNewProjectKind(event.target.value as SavedProjectKind)}
                  >
                    <option value="folder">Папка</option>
                    <option value="workspace">Файл .code-workspace</option>
                  </select>
                </label>
                <label className="field">
                  <span>Путь</span>
                  <ProjectPathInput
                    kind={newProjectKind}
                    value={newProjectPath}
                    pathTestId="inline-project-path"
                    pickTestId="inline-pick-project-path"
                    disabled={busy}
                    onChange={setNewProjectPath}
                    onPickError={setError}
                  />
                </label>
                <label className="field">
                  <span>Алиас (необязательно)</span>
                  <input
                    data-testid="inline-project-alias"
                    value={newProjectAlias}
                    onChange={(event) => setNewProjectAlias(event.target.value)}
                    placeholder="Как показывать в списке"
                  />
                </label>
                <div className="compose-action">
                  <button
                    type="button"
                    className="primary"
                    data-testid="save-inline-project"
                    disabled={busy || !newProjectPath.trim()}
                    onClick={() => void addProjectFromForm()}
                  >
                    Сохранить в раздел проектов
                  </button>
                  {projectSaveError ? (
                    <p className="inline-error" data-testid="inline-project-save-error">
                      {projectSaveError}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="team-pick" aria-labelledby="compose-team">
            <h3 id="compose-team" className="team-pick-title">
              Исполнители
            </h3>
            <p className="hint">Либо отдельные агенты с режимом, либо готовый процесс с холста — не оба сразу.</p>
            <div className="row-actions">
              <button
                type="button"
                data-testid="add-agent"
                disabled={busy}
                onClick={() => {
                  setProcessPickerOpen(false)
                  setAgentPickerOpen((value) => !value)
                }}
              >
                Добавить агента
              </button>
              <button
                type="button"
                data-testid="pick-process"
                disabled={busy}
                onClick={() => {
                  setAgentPickerOpen(false)
                  setProcessPickerOpen((value) => !value)
                }}
              >
                Выбрать процесс
              </button>
            </div>
            {agentPickerOpen ? (
              <ul className="picker-list" data-testid="agent-picker">
                {availableAgents.length === 0 ? (
                  <li className="hint">Все агенты уже добавлены.</li>
                ) : (
                  availableAgents.map((agent) => (
                    <li key={agent.id}>
                      <button type="button" onClick={() => addAgent(agent)}>
                        {agent.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {processPickerOpen ? (
              <ul className="picker-list" data-testid="process-picker">
                {workflows.length === 0 ? (
                  <li className="hint">Процессов пока нет — создайте на экране «Процессы».</li>
                ) : (
                  workflows.map((workflow) => (
                    <li key={workflow.id}>
                      <button type="button" onClick={() => chooseWorkflow(workflow)}>
                        {workflow.name}
                        <small>{workflow.steps.length} шаг(ов)</small>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {selectedWorkflow ? (
              <p className="where" data-testid="selected-process">
                Процесс: {selectedWorkflow.name}
                <button type="button" className="text-btn" onClick={() => setWorkflowId(null)}>
                  Убрать
                </button>
              </p>
            ) : null}
            {pickedAgents.length > 0 ? (
              <ul className="picked-agents" data-testid="picked-agents">
                {pickedAgents.map((member) => {
                  const agent = agentMap.get(member.agentId)
                  return (
                    <li key={member.agentId} className="team-row">
                      <strong>{agent?.name ?? member.agentId}</strong>
                      <select
                        aria-label={`Режим: ${agent?.name ?? member.agentId}`}
                        value={member.mode}
                        onChange={(event) =>
                          setPickedAgents((list) =>
                            list.map((item) =>
                              item.agentId === member.agentId
                                ? { ...item, mode: event.target.value as WorkMode }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="ask">Вопрос</option>
                        <option value="plan">План</option>
                        <option value="agent">Агент</option>
                      </select>
                      <button type="button" onClick={() => removeAgent(member.agentId)}>
                        Убрать
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </section>

          <div className="compose-footer">
            <button type="submit" className="primary" data-testid="create-task" disabled={busy || !title.trim()}>
              Создать
            </button>
            <button type="button" onClick={() => setCreating(false)}>
              Закрыть
            </button>
          </div>
        </form>
      ) : null}
      <div className="board-columns">
        {COLUMNS.map((status) => {
          const column = tasks.filter((task) => task.status === status)
          return (
            <section
              key={status}
              className={over === status ? 'board-col over' : 'board-col'}
              data-testid={`board-column-${status}`}
              data-status={status}
              onDragOver={(event) => {
                event.preventDefault()
                setOver(status)
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return
                setOver(null)
              }}
              onDrop={(event) => onDrop(status, event)}
            >
              <header>
                <span>{columnLabel(status)}</span>
                <em className="count">{column.length}</em>
              </header>
              <div className="lane">
                {column.length === 0 ? <p className="empty">Пока пусто</p> : null}
                {column.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    names={agentMap}
                    onMove={(next) => void move(task.id, next)}
                    onDelete={() => void dropTask(task)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function taskOpenBlockReason(task: BoardTask): string {
  if (task.runId) return ''
  if (task.status === 'new') return 'Запуска ещё нет — сначала переведите задачу в работу.'
  return 'Запуск для этой задачи пока не создан.'
}

function TaskCard({
  task,
  names,
  onMove,
  onDelete,
}: {
  task: BoardTask
  names: Map<string, Agent>
  onMove: (status: BoardStatus) => void
  onDelete: () => void
}) {
  const skipClick = useRef(false)
  const [openHint, setOpenHint] = useState<string | null>(null)
  const expectsPlan = task.plan !== null || task.team.some((member) => member.mode === 'plan')
  const rows =
    task.activity.length > 0
      ? task.activity
      : task.team.map((member) => ({
          agentId: member.agentId,
          agentName: names.get(member.agentId)?.name ?? 'Агент',
          mode: member.mode,
          state: 'waiting' as const,
          note: '',
        }))

  function openRun(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented) return
    if (skipClick.current) {
      skipClick.current = false
      return
    }
    if (task.status === 'review' || task.status === 'completed') {
      setOpenHint(null)
      window.location.hash = href({ name: 'task', taskId: task.id })
      return
    }
    if (task.runId) {
      setOpenHint(null)
      window.location.hash = href({ name: 'run', runId: task.runId })
      return
    }
    setOpenHint(taskOpenBlockReason(task))
  }

  return (
    <article
      className={task.runId ? 'task-card open-run' : 'task-card'}
      data-testid="task-card"
      data-status={task.status}
      data-has-run={task.runId ? 'true' : 'false'}
      draggable={task.status === 'new'}
      onClick={openRun}
      onDragStart={(event) => {
        skipClick.current = true
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          skipClick.current = false
        }, 0)
      }}
    >
      <h2>{task.title}</h2>
      {task.description ? <p>{task.description}</p> : null}
      {task.projectLabel ? (
        <p className="hint" data-testid="task-card-project">
          Проект: {task.projectLabel}
          {task.workflowName ? ` · процесс «${task.workflowName}»` : ''}
        </p>
      ) : null}
      <ul className="member-list">
        {rows.map((member) => (
          <li key={member.agentId} className={`member-line ${member.state}`}>
            <span className={member.state === 'working' ? 'presence' : 'presence off'} aria-hidden="true" />
            <strong>{member.agentName}</strong>
            <span>{modeLabel(member.mode)}</span>
            {member.note ? (
              <span data-testid="team-note">
                {memberStateLabel(member.state)} · {member.note}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {openHint ? (
        <p className="task-card-open-hint" data-testid="task-card-open-hint">
          {openHint}
        </p>
      ) : null}
      <div
        className="row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {task.status === 'new' ? (
          <button type="button" data-testid="move-in-progress" onClick={() => onMove('in_progress')}>
            В работу
          </button>
        ) : null}
        {expectsPlan ? (
          <a className="text-btn" data-testid="open-plan" href={href({ name: 'plan', taskId: task.id })}>
            Открыть план
          </a>
        ) : null}
        <button type="button" className="text-btn danger" data-testid="delete-task" onClick={onDelete}>
          Удалить
        </button>
      </div>
    </article>
  )
}
