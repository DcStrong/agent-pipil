import { LayoutGroup } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { api, messageOf, subscribeRuns } from '../api'
import { TaskCard } from '../components/TaskCard'
import { clock, finalResultText, firstSentence, statusLine, taskTitle } from '../format'
import type { PipelineStage, Role, Run } from '../types'

interface Column {
  stageId: string
  roleName: string
  handoffInstruction: string
  summary: string | null
  output: string | null
  prompt: string
}

function mergeRun(list: Run[], run: Run): Run[] {
  const existing = list.find((item) => item.id === run.id)
  if (existing && existing.updatedAt > run.updatedAt) return list
  const rest = list.filter((item) => item.id !== run.id)
  return [run, ...rest].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function columnsFor(run: Run | null, stages: PipelineStage[], roles: Role[]): Column[] {
  if (run) {
    return run.stages.map((stage) => {
      const work = run.work.find((item) => item.stageId === stage.stageId)
      return {
        stageId: stage.stageId,
        roleName: stage.roleName,
        handoffInstruction: stage.handoffInstruction,
        summary: work?.summary ?? null,
        output: work?.output ?? null,
        prompt: stage.systemPrompt,
      }
    })
  }
  return stages.map((stage) => {
    const role = roles.find((item) => item.id === stage.roleId)
    return {
      stageId: stage.id,
      roleName: role?.name ?? 'Missing role',
      handoffInstruction: stage.handoffInstruction,
      summary: null,
      output: null,
      prompt: role?.systemPrompt ?? '',
    }
  })
}

function cardHost(run: Run | null): string | null {
  if (!run) return null
  if (run.status === 'completed') return 'end'
  if (run.stageIndex === null) return null
  return run.stages[run.stageIndex]?.stageId ?? null
}

export function BoardPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [task, setTask] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    let cancel = false
    void Promise.all([api.roles(), api.pipeline(), api.runs()])
      .then(([nextRoles, nextStages, nextRuns]) => {
        if (cancel) return
        setRoles(nextRoles)
        setStages(nextStages)
        setRuns(nextRuns)
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(messageOf(reason))
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => subscribeRuns((message) => {
    if (message.type === 'run') setRuns((current) => mergeRun(current, message.run))
  }), [])

  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null
  const runningId = selected?.status === 'running' ? selected.id : null

  useEffect(() => {
    if (!runningId) return
    const timer = window.setInterval(() => {
      void api
        .run(runningId)
        .then((run) => setRuns((current) => mergeRun(current, run)))
        .catch(() => undefined)
    }, 400)
    return () => window.clearInterval(timer)
  }, [runningId])

  const columns = useMemo(
    () => columnsFor(selected, stages, roles),
    [selected, stages, roles],
  )
  const host = cardHost(selected)
  const focused = columns.find((column) => column.stageId === focusId) ?? null
  const line = statusLine(selected)

  async function send() {
    const nextTask = task.trim()
    if (!nextTask) {
      setError('Write a task before sending it.')
      return
    }
    setSending(true)
    setError(null)
    try {
      const run = await api.startRun(nextTask)
      setRuns((current) => mergeRun(current, run))
      setSelectedId(run.id)
      setFocusId(null)
      setTask('')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <main className="page board-page">
        <p className="crumb">Workflow / Delivery</p>
        <div className="page-head">
          <h1>Board</h1>
        </div>
        <p className="lede">One task moves from role to role. The agent who owns it is the column holding the card.</p>
        <p className="status-line" aria-live="polite">
          {line}
        </p>
        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
        <LayoutGroup>
          <div className="canvas" aria-label="Delivery board">
            <div className="marker">
              <span className="dot" />
              <span>Start</span>
            </div>
            {columns.map((column, index) => {
              const live = host === column.stageId
              return (
                <div className="canvas-step" key={column.stageId}>
                  {index > 0 ? (
                    <div className="route" title={columns[index - 1]?.handoffInstruction}>
                      <span>Handoff</span>
                    </div>
                  ) : null}
                  <section
                    className={[
                      'step',
                      live ? 'is-live' : '',
                      column.summary ? 'is-passed' : '',
                      focusId === column.stageId ? 'is-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <button type="button" className="step-hit" onClick={() => setFocusId(column.stageId)}>
                      <span className="eyebrow">{live ? 'Owns the task' : `Stage ${index + 1}`}</span>
                      <strong>{column.roleName}</strong>
                      <em>{column.summary ?? firstSentence(column.prompt)}</em>
                    </button>
                    <div className="step-body">
                      {live && selected ? <TaskCard run={selected} reduced={reduced} /> : null}
                      {!live && column.summary ? <p className="passed">Passed</p> : null}
                      {!live && !column.summary ? <p className="waiting">Waiting</p> : null}
                    </div>
                  </section>
                </div>
              )
            })}
            <div className="route">
              <span>End</span>
            </div>
            <div className={`marker end ${host === 'end' ? 'holds' : ''}`}>
              <span className="dot" />
              <span>End</span>
              {host === 'end' && selected ? <TaskCard run={selected} reduced={reduced} /> : null}
            </div>
          </div>
        </LayoutGroup>
      </main>
      <aside className="sidebar">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <h2>Send work</h2>
          <label>
            Task
            <textarea
              rows={5}
              value={task}
              placeholder="Add a password reset flow to the settings page."
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
          </label>
          <button
            type="submit"
            className="primary"
            disabled={sending || selected?.status === 'running'}
          >
            {selected?.status === 'running' ? 'A task is moving' : 'Send through pipeline'}
          </button>
          <p className="hint">One task at a time. Ctrl or Cmd Enter also sends.</p>
        </form>

        {selected?.status === 'completed' && selected.finalResult ? (
          <section className="result" aria-label="Final result">
            <h2>Final result</h2>
            <p className="hint">{taskTitle(selected.task)}</p>
            <pre>{finalResultText(selected.finalResult)}</pre>
          </section>
        ) : null}

        {selected?.status === 'failed' ? (
          <p className="banner" role="alert">
            {selected.error ?? 'The run stopped.'}
          </p>
        ) : null}

        {focused ? (
          <section className="stack">
            <h2>{focused.roleName}</h2>
            {focused.handoffInstruction ? (
              <p className="hint">Handoff: {focused.handoffInstruction}</p>
            ) : (
              <p className="hint">This stage closes the run.</p>
            )}
            {focused.output ? <pre>{focused.output}</pre> : <p className="hint">No output yet.</p>}
          </section>
        ) : null}

        {runs.length > 0 ? (
          <section>
            <h2>Runs</h2>
            <ul className="run-list">
              {runs.slice(0, 8).map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className={run.id === selected?.id ? 'run-chip is-selected' : 'run-chip'}
                    onClick={() => {
                      setSelectedId(run.id)
                      setFocusId(null)
                    }}
                  >
                    <strong>{taskTitle(run.task)}</strong>
                    <span>{run.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {selected ? (
          <section>
            <h2>Activity</h2>
            <ol className="activity">
              {[...selected.events].reverse().slice(0, 8).map((event) => (
                <li key={event.id}>
                  <time dateTime={event.at}>{clock(event.at)}</time>
                  <span>{event.message}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </aside>
    </>
  )
}
