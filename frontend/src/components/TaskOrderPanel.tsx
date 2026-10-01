/** Части задачи, когда включено глубокое мышление. План можно поправить до сборки. */
import { useEffect, useRef, useState } from 'react'
import type { Run, TaskPlan } from '../types'

export function TaskOrderPanel({
  run,
  busy,
  onSave,
}: {
  run: Run
  busy: boolean
  onSave: (plan: TaskPlan) => Promise<void>
}) {
  const [why, setWhy] = useState(run.plan?.why ?? '')
  const [changes, setChanges] = useState(run.plan?.changes ?? '')
  const [how, setHow] = useState(run.plan?.how ?? '')
  const [checklist, setChecklist] = useState(run.plan?.checklist ?? '')
  const seeded = useRef<string | null>(null)

  useEffect(() => {
    if (run.status !== 'waiting_plan' || !run.plan) return
    if (seeded.current === run.id) return
    seeded.current = run.id
    setWhy(run.plan.why)
    setChanges(run.plan.changes)
    setHow(run.plan.how)
    setChecklist(run.plan.checklist)
  }, [run])

  if (!run.deepThinking) return null
  const editing = run.status === 'waiting_plan' && run.plan

  return (
    <section className="pieces" data-testid="task-pieces">
      <h2>Порядок задачи</h2>
      {run.note ? (
        <>
          <h3>Заметка</h3>
          <p data-testid="task-note">{run.note}</p>
        </>
      ) : null}
      {editing ? (
        <>
          <h3>План</h3>
          <label className="field">
            <span>Зачем</span>
            <textarea data-testid="plan-why" value={why} onChange={(event) => setWhy(event.target.value)} />
          </label>
          <label className="field">
            <span>Что меняется</span>
            <textarea data-testid="plan-changes" value={changes} onChange={(event) => setChanges(event.target.value)} />
          </label>
          <label className="field">
            <span>Как</span>
            <textarea data-testid="plan-how" value={how} onChange={(event) => setHow(event.target.value)} />
          </label>
          <label className="field">
            <span>Чеклист</span>
            <textarea data-testid="plan-checklist" value={checklist} onChange={(event) => setChecklist(event.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            data-testid="save-plan"
            disabled={busy || !why.trim() || !changes.trim() || !how.trim() || !checklist.trim()}
            onClick={() => void onSave({ why, changes, how, checklist })}
          >
            К сборке
          </button>
        </>
      ) : run.plan ? (
        <>
          <h3>Зачем</h3>
          <p data-testid="plan-why">{run.plan.why}</p>
          <h3>Что меняется</h3>
          <p data-testid="plan-changes">{run.plan.changes}</p>
          <h3>Как</h3>
          <p data-testid="plan-how">{run.plan.how}</p>
          <h3>Чеклист</h3>
          <p data-testid="plan-checklist">{run.plan.checklist}</p>
        </>
      ) : null}
      {run.buildText ? (
        <>
          <h3>Сборка</h3>
          <p data-testid="task-build">{run.buildText}</p>
        </>
      ) : null}
      {run.reviewText ? (
        <>
          <h3>Сверка</h3>
          <p data-testid="task-review">{run.reviewText}</p>
        </>
      ) : null}
      {run.archive ? (
        <>
          <h3>Архив</h3>
          <p data-testid="task-archive">{run.archive.result}</p>
        </>
      ) : null}
    </section>
  )
}
