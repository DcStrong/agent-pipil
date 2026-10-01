/** Доска из трёх колонок. Перенос в работу запускает выбранную команду. */
import { useState, type DragEvent } from 'react'
import { api, messageOf } from '../api'
import { columnLabel, defaultWorkMode, memberStateLabel, modeLabel } from '../board'
import { IconPlus } from '../components/Icons'
import { useLive } from '../live'
import { href } from '../route'
import type { Agent, BoardStatus, BoardTask, WorkMode } from '../types'

const COLUMNS: BoardStatus[] = ['new', 'in_progress', 'review']

export function BoardPage() {
  const { ready, error: loadError, agents, tasks, upsertTask } = useLive()
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<Record<string, WorkMode | 'off'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState<BoardStatus | null>(null)

  const selection = picked ?? defaultSelection(agents)
  const team = agents.flatMap((agent) => {
    const mode = selection[agent.id]
    if (!mode || mode === 'off') return []
    return [{ agentId: agent.id, mode }]
  })

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const task = await api.createTask({ title, description, team })
      upsertTask(task)
      setTitle('')
      setDescription('')
      setCreating(false)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
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

  function onDrop(status: BoardStatus, event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setOver(null)
    const id = event.dataTransfer.getData('text/plain')
    if (id) void move(id, status)
  }

  return (
    <div className="board-page">
      <header className="board-head">
        <div>
          <h1>Доска</h1>
          <p className="hint board-hint">
            Новая задача ждёт в первой колонке. В работе её берёт выбранная команда. На проверку она
            переходит сама, когда ход закончен.
          </p>
        </div>
        <button type="button" className="primary" data-testid="new-task" onClick={() => setCreating((value) => !value)}>
          <IconPlus />
          Новая задача
        </button>
      </header>
      {loadError ? <p className="banner">{loadError}</p> : null}
      {error ? <p className="banner">{error}</p> : null}
      {!ready && !loadError ? <p className="muted">Загрузка…</p> : null}
      {creating ? (
        <form
          className="card compose"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
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
          <fieldset className="team-pick">
            <legend>Команда</legend>
            <p className="hint">Вопрос не проходит через план. План можно править и только потом отдать в сборку.</p>
            {agents.map((agent) => (
              <TeamRow
                key={agent.id}
                agent={agent}
                mode={selection[agent.id] ?? 'off'}
                onMode={(mode) => setPicked({ ...selection, [agent.id]: mode })}
              />
            ))}
          </fieldset>
          <div className="row-actions">
            <button type="submit" className="primary" data-testid="create-task" disabled={busy || !title.trim() || team.length === 0}>
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
                    names={new Map(agents.map((agent) => [agent.id, agent.name]))}
                    onMove={(next) => void move(task.id, next)}
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

function defaultSelection(agents: Agent[]): Record<string, WorkMode | 'off'> {
  const next: Record<string, WorkMode | 'off'> = {}
  for (const agent of agents) {
    const on = agent.id === 'role_architect' || agent.id === 'role_developer'
    next[agent.id] = on ? defaultWorkMode(agent.kind) : 'off'
  }
  return next
}

function TeamRow({
  agent,
  mode,
  onMode,
}: {
  agent: Agent
  mode: WorkMode | 'off'
  onMode: (mode: WorkMode | 'off') => void
}) {
  const on = mode !== 'off'
  return (
    <div className="team-row">
      <input
        id={`team-${agent.id}`}
        type="checkbox"
        checked={on}
        data-testid={`team-${agent.id}`}
        onChange={(event) => onMode(event.target.checked ? defaultWorkMode(agent.kind) : 'off')}
      />
      <label htmlFor={`team-${agent.id}`}>{agent.name}</label>
      <select
        aria-label={`Режим: ${agent.name}`}
        value={on ? mode : defaultWorkMode(agent.kind)}
        disabled={!on}
        onChange={(event) => onMode(event.target.value as WorkMode)}
      >
        <option value="ask">Вопрос</option>
        <option value="plan">План</option>
        <option value="agent">Агент</option>
      </select>
    </div>
  )
}

function TaskCard({
  task,
  names,
  onMove,
}: {
  task: BoardTask
  names: Map<string, string>
  onMove: (status: BoardStatus) => void
}) {
  const expectsPlan = task.plan !== null || task.team.some((member) => member.mode === 'plan')
  const rows =
    task.activity.length > 0
      ? task.activity
      : task.team.map((member) => ({
          agentId: member.agentId,
          agentName: names.get(member.agentId) ?? 'Агент',
          mode: member.mode,
          state: 'waiting' as const,
          note: '',
        }))
  return (
    <article
      className="task-card"
      data-testid="task-card"
      data-status={task.status}
      draggable={task.status === 'new'}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
    >
      <h2>{task.title}</h2>
      {task.description ? <p>{task.description}</p> : null}
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
      <div className="row-actions">
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
      </div>
    </article>
  )
}
