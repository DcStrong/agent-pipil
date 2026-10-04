/** Продолжить прерванный запуск или повторить текущий шаг. */
import type { Run } from '../types'

export function ResumeRun({
  run,
  busy,
  onResume,
}: {
  run: Run
  busy: boolean
  onResume: (mode: 'continue' | 'retry') => void
}) {
  return (
    <div className="decision" data-testid="run-resume">
      <p>
        Запуск прервался. Готовые шаги сохранены — можно продолжить с места обрыва или
        повторить текущий шаг.
      </p>
      {run.error ? <p className="error-line">{run.error}</p> : null}
      <div className="row-actions">
        <button
          type="button"
          className="primary decision-btn"
          data-testid="resume-continue"
          disabled={busy}
          onClick={() => onResume('continue')}
        >
          Продолжить
        </button>
        <button
          type="button"
          className="decision-btn"
          data-testid="resume-retry"
          disabled={busy}
          onClick={() => onResume('retry')}
        >
          Повторить шаг
        </button>
      </div>
    </div>
  )
}
