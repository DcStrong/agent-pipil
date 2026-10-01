/** План как в режиме плана Cursor: читать, править, затем отдать в сборку и только потом на проверку. */
import { useState } from 'react'
import { api, messageOf } from '../api'
import { planStep } from '../board'
import { useLive } from '../live'
import { href } from '../route'

const STEPS = [
  { title: 'План', note: 'Можно читать и править' },
  { title: 'Сборка', note: 'Только после плана' },
  { title: 'Проверка', note: 'Только после сборки' },
]

export function PlanPage({ taskId }: { taskId: string }) {
  const { ready, tasks, upsertTask } = useLive()
  const task = tasks.find((item) => item.id === taskId)
  const [edit, setEdit] = useState<{ stamp: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const stamp = `${task?.id ?? ''}:${task?.plan?.updatedAt ?? ''}`
  const text = edit?.stamp === stamp ? edit.text : (task?.plan?.text ?? '')

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

  const current = planStep(task.phase)
  const editable = task.phase === 'plan' && task.plan?.editable === true
  const expectsPlan = task.team.some((member) => member.mode === 'plan')

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.saveBoardPlan(taskId, text)
      upsertTask(next)
      setEdit(null)
      setSaved(true)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function hand() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const next = await api.handPlan(taskId, text)
      upsertTask(next)
      setEdit(null)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow plan-page">
      <a className="text-link" href={href({ name: 'board' })}>
        К доске
      </a>
      <h1 className="page-title">{task.title}</h1>
      <p className="hint plan-lead">
        {task.plan
          ? `План составил ${task.plan.authorName}. Его можно править здесь, затем отдать в сборку. Проверка этот шаг не заменяет.`
          : task.phase === 'working' && expectsPlan
            ? 'Команда уже берёт задачу и составляет план. Текст появится здесь, его можно будет править до сборки.'
            : expectsPlan
              ? 'План появится, когда задача уйдёт в работу. Его можно будет править до сборки.'
              : 'У этой задачи нет плана: команда работает в режиме вопроса. Через план её проводить не нужно.'}
      </p>
      {expectsPlan || task.plan ? (
        <ol className="plan-steps" data-testid="plan-order">
          {STEPS.map((step, index) => {
            const mark = current < 0 ? '' : index < current ? 'done' : index === current ? 'on' : ''
            return (
              <li key={step.title} className={mark} data-testid={`plan-step-${index}`}>
                <strong>{step.title}</strong>
                <small>{step.note}</small>
              </li>
            )
          })}
        </ol>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      {saved ? <p className="ok-line">План сохранён.</p> : null}
      {task.plan ? (
        <>
          <label className="field">
            <span>Текст плана</span>
            <textarea
              className="plan-editor"
              data-testid="plan-text"
              value={text}
              readOnly={!editable}
              onChange={(event) => {
                setEdit({ stamp, text: event.target.value })
                setSaved(false)
              }}
            />
          </label>
          <div className="row-actions">
            <button type="button" data-testid="save-plan" disabled={busy || !editable} onClick={() => void save()}>
              Сохранить
            </button>
            <button type="button" className="primary" data-testid="hand-build" disabled={busy || !editable || !text.trim()} onClick={() => void hand()}>
              Отдать в сборку
            </button>
          </div>
          {task.phase === 'build' ? <p className="now">Сборка идёт по этому плану. На проверку задача встанет сама.</p> : null}
          {task.phase === 'done' ? <p className="now">Сборка закончена, задача на проверке. Порядок план → сборка → проверка не пропускался.</p> : null}
        </>
      ) : null}
      <p className="hint" data-testid="plan-phase" data-phase={task.phase}>
        Ход имитируется, сохранённый токен сеть не вызывает.
      </p>
    </div>
  )
}
