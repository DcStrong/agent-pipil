/** Задача на доске: сводки агентов, полный диалог запуска и действия на проверке. */
import { useState } from 'react'
import { api, messageOf } from '../api'
import { modeLabel, taskStatusLabel } from '../board'
import { useLive } from '../live'
import { href } from '../route'
import type { BoardTask, Run, StepWork } from '../types'

type StepView = {
  key: string
  agentName: string
  title: string
  summary: string
  detail: string | null
  stepId: string | null
}

function stepsForTask(task: BoardTask, run: Run | undefined): StepView[] {
  if (run && run.work.length > 0) {
    return run.work.map((item: StepWork) => ({
      key: item.stepId,
      agentName: item.agentName,
      title: item.title,
      summary: item.summary,
      detail: item.output,
      stepId: item.stepId,
    }))
  }
  if (task.activity.length > 0) {
    return task.activity.map((item) => ({
      key: item.agentId,
      agentName: item.agentName,
      title: modeLabel(item.mode),
      summary: item.note,
      detail: null,
      stepId: null,
    }))
  }
  return task.team.map((member) => ({
    key: member.agentId,
    agentName: member.agentId,
    title: modeLabel(member.mode),
    summary: 'Шаг ещё не начался.',
    detail: null,
    stepId: null,
  }))
}

export function TaskPage({ taskId }: { taskId: string }) {
  const { ready, tasks, runs, upsertTask, upsertRun, removeTask, removeRun } = useLive()
  const task = tasks.find((item) => item.id === taskId)
  const run = task?.runId ? runs.find((item) => item.id === task.runId) : undefined
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reopenNote, setReopenNote] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!ready) {
    return (
      <div className="page">
        <p className="muted">Загрузка…</p>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="page narrow">
        <p className="muted">Задача не найдена.</p>
        <a href={href({ name: 'board' })}>К доске</a>
      </div>
    )
  }

  const steps = stepsForTask(task, run)
  const onReview = task.status === 'review'
  const done = task.status === 'completed'
  const waitingQuestion = run?.status === 'waiting_user'

  async function dropTask() {
    if (
      !window.confirm(
        `Удалить задачу «${task.title}» и все её запуски? Это нельзя отменить.`,
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.deleteTask(taskId)
      removeTask(taskId)
      for (const item of runs) {
        if (item.id === task.runId || item.boardTaskId === taskId) {
          removeRun(item.id)
        }
      }
      window.location.hash = href({ name: 'board' })
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function complete() {
    setBusy(true)
    setError(null)
    try {
      upsertTask(await api.completeTask(taskId))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function reopen() {
    setBusy(true)
    setError(null)
    try {
      upsertTask(await api.reopenTask(taskId, reopenNote))
      setReopenNote('')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function sendAnswer() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.answerTask(taskId, answer)
      upsertTask(result.task)
      upsertRun(result.run)
      setAnswer('')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page task-page">
      <a className="text-link" href={href({ name: 'board' })}>
        К доске
      </a>
      <header className="task-page-head">
        <div>
          <p className="crumb muted">Задача · {task.projectLabel}</p>
          <h1>{task.title}</h1>
          <span className={`pill ${task.status}`} data-testid="task-status">
            {taskStatusLabel(task.status)}
          </span>
        </div>
        <div className="task-page-actions">
          {task.runId ? (
            <a className="text-btn" data-testid="open-full-run" href={href({ name: 'run', runId: task.runId })}>
              Полный диалог запуска
            </a>
          ) : null}
          <button
            type="button"
            className="text-btn danger"
            data-testid="delete-task"
            disabled={busy}
            onClick={() => void dropTask()}
          >
            Удалить
          </button>
        </div>
      </header>

      {task.description ? (
        <section className="card task-body-block">
          <h2>Описание</h2>
          <pre className="task-description" data-testid="task-description">
            {task.description}
          </pre>
        </section>
      ) : null}

      <section className="card agent-summaries" aria-labelledby="agent-steps">
        <h2 id="agent-steps">Что сделали агенты</h2>
        <p className="hint">Короткая сводка по шагам. Разверните строку или откройте полный диалог запуска.</p>
        <ol className="agent-step-list" data-testid="agent-summaries">
          {steps.map((step) => (
            <li key={step.key} className="agent-step">
              <div className="agent-step-head">
                <strong>{step.agentName}</strong>
                <span className="muted">{step.title}</span>
              </div>
              <p className="agent-step-summary">{step.summary}</p>
              {step.detail ? (
                <>
                  <button
                    type="button"
                    className="text-btn"
                    data-testid={`toggle-detail-${step.key}`}
                    onClick={() => setExpanded((current) => (current === step.key ? null : step.key))}
                  >
                    {expanded === step.key ? 'Скрыть подробности' : 'Подробнее'}
                  </button>
                  {expanded === step.key ? (
                    <pre className="agent-step-detail" data-testid={`detail-${step.key}`}>
                      {step.detail}
                    </pre>
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {waitingQuestion && onReview ? (
        <section className="card review-question" data-testid="task-question">
          <h2>Вопрос от агента</h2>
          <p>{run?.pendingQuestion}</p>
          <label className="field">
            <span>Ваш ответ</span>
            <textarea
              data-testid="task-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Ответ уйдёт в диалог роли"
            />
          </label>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              data-testid="task-send-answer"
              disabled={busy || !answer.trim()}
              onClick={() => void sendAnswer()}
            >
              Ответить
            </button>
          </div>
        </section>
      ) : null}

      {onReview ? (
        <section className="card review-actions" data-testid="review-actions">
          <h2>Дальше</h2>
          <p className="hint">
            Допишите задачу и верните в работу, примите результат или ответьте на вопрос выше.
          </p>
          <label className="field">
            <span>Дополнение к задаче</span>
            <textarea
              data-testid="reopen-note"
              value={reopenNote}
              onChange={(event) => setReopenNote(event.target.value)}
              placeholder="Что изменить или уточнить для следующего прохода"
            />
          </label>
          <div className="row-actions review-action-row">
            <button
              type="button"
              data-testid="reopen-task"
              disabled={busy || !reopenNote.trim()}
              onClick={() => void reopen()}
            >
              Вернуть в работу
            </button>
            <button
              type="button"
              className="primary"
              data-testid="complete-task"
              disabled={busy}
              onClick={() => void complete()}
            >
              Завершить
            </button>
          </div>
        </section>
      ) : null}

      {done ? (
        <p className="hint" data-testid="task-completed-note">
          Задача завершена и больше не на доске.
        </p>
      ) : null}

      {error ? <p className="banner">{error}</p> : null}
    </div>
  )
}
