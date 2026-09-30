/** Журнал одного запуска и панель сведений. Текст ошибки приходит с сервера. */
import { useState } from 'react'
import { api, messageOf } from '../api'
import { clock, duration, eventTag, finalText, harnessLabel, statusLabel, taskTitle } from '../format'
import { useLive } from '../live'
import { href } from '../route'

export function RunPage({ runId }: { runId: string }) {
  const { ready, runs, upsertRun } = useLive()
  const run = runs.find((item) => item.id === runId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')

  async function sendAnswer() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.answer(run.id, answer))
      setAnswer('')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.decide(run.id, decision))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <div className="page">
        <p className="muted">Загрузка…</p>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="page">
        <p className="muted">Запуск не найден.</p>
        <a href={href({ name: 'runs' })}>К запускам</a>
      </div>
    )
  }

  const step = run.stepIndex !== null ? run.steps[run.stepIndex] : run.steps[0]

  return (
    <div className="run-page">
      <section className="log-pane">
        <p className="crumb">
          <a href={href({ name: 'workflows' })}>Процессы</a>
          <span>/</span>
          <a href={href({ name: 'runs' })}>Запуски</a>
          <span>/</span>
          <span>{taskTitle(run.task)}</span>
        </p>
        <header className="log-head">
          <h1>{run.workflowName}</h1>
          <p>{taskTitle(run.task)}</p>
        </header>
        <ol className="activity">
          {run.events.map((event) => (
            <li key={event.id}>
              <time>{clock(event.at)}</time>
              <span className={`tag ${event.kind}`}>{eventTag(event.kind)}</span>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
        <div className="roles">
          {run.steps.map((item) => (
            <button
              key={item.dialogueId}
              type="button"
              data-testid={`open-${item.kind}`}
              onClick={() => setOpened(item.stepId)}
            >
              {item.title}
            </button>
          ))}
        </div>
        {run.steps
          .filter((item) => item.stepId === (opened ?? run.steps[run.stepIndex ?? 0]?.stepId ?? run.steps[0]?.stepId))
          .map((item) => (
            <section key={item.dialogueId} className="dialogue" data-testid="dialogue">
              <h2>Диалог · {item.title}</h2>
              {item.messages.map((message) => (
                <p key={message.id} className={`bubble ${message.author}`}>
                  {message.text}
                </p>
              ))}
            </section>
          ))}
        {run.status === 'waiting_user' ? (
          <div className="decision">
            <p>Роль ждёт ответа. Оркестратор за вас не отвечает.</p>
            <p>{run.pendingQuestion}</p>
            <label className="field">
              <span>Ответ</span>
              <textarea data-testid="user-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </label>
            <button type="button" className="primary" data-testid="send-answer" disabled={busy || !answer.trim()} onClick={() => void sendAnswer()}>
              Ответить
            </button>
          </div>
        ) : null}
        {run.status === 'waiting_approval' ? (
          <div className="decision">
            <p>Шаг ждёт вашего подтверждения.</p>
            <div className="row-actions">
              <button type="button" className="primary" data-testid="approve" disabled={busy} onClick={() => void decide('approve')}>
                Одобрить
              </button>
              <button type="button" data-testid="reject" disabled={busy} onClick={() => void decide('reject')}>
                Отклонить
              </button>
            </div>
          </div>
        ) : null}
        {run.status === 'completed' && run.finalResult ? (
          <article className="result" data-testid="final-result">
            <h2>Итог</h2>
            <p>{finalText(run.finalResult)}</p>
          </article>
        ) : null}
        {run.error ? <p className="error-line">{run.error}</p> : null}
        {error ? <p className="error-line">{error}</p> : null}
      </section>
      <aside className="details">
        <h2>Сведения</h2>
        <dl>
          <div>
            <dt>Статус</dt>
            <dd>
              <span className={`pill ${run.status}`} data-testid="run-status">
                {statusLabel(run.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Задача</dt>
            <dd>{taskTitle(run.task)}</dd>
          </div>
          <div>
            <dt>Среда</dt>
            <dd>{step ? harnessLabel(step.harness) : '—'}</dd>
          </div>
          <div>
            <dt>Всего токенов</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Входные токены</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Выходные токены</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Длительность</dt>
            <dd>{duration(run)}</dd>
          </div>
          <div>
            <dt>Начат</dt>
            <dd>{clock(run.createdAt)}</dd>
          </div>
          <div>
            <dt>Окончен</dt>
            <dd>{run.finishedAt ? clock(run.finishedAt) : '—'}</dd>
          </div>
        </dl>
      </aside>
    </div>
  )
}
