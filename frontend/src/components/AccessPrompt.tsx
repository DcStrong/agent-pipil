import type { AccessDecision, Run } from '../types'

/** Запрос доступа к папке: всегда, только этот запуск или отказ. */
export function AccessPrompt({
  run,
  busy,
  onDecide,
}: {
  run: Run
  busy: boolean
  onDecide: (decision: AccessDecision) => void
}) {
  if (run.status !== 'waiting_access' || !run.pendingAccess) return null
  const request = run.pendingAccess
  const shell = request.kind === 'shell'
  return (
    <div className="decision" data-testid="access-wait">
      <p>
        {shell
          ? 'Агент хочет выполнить команду. Разрешите её, если доверяете этому вызову.'
          : 'Агент просит доступ к папке проекта. Cursor сможет читать файлы и выполнять команды внутри неё.'}
      </p>
      <p>{request.message}</p>
      {shell ? (
        <pre className="trace-line" data-testid="access-command">
          {request.command || request.path}
        </pre>
      ) : (
        <p className="hint" data-testid="access-path">
          {request.path}
        </p>
      )}
      <div className="row-actions">
        <button
          type="button"
          className="primary decision-btn"
          data-testid="access-always"
          disabled={busy}
          onClick={() => onDecide('always')}
        >
          Разрешить всегда
        </button>
        <button
          type="button"
          className="decision-btn"
          data-testid="access-once"
          disabled={busy}
          onClick={() => onDecide('once')}
        >
          Один раз
        </button>
        <button
          type="button"
          className="decision-btn"
          data-testid="access-deny"
          disabled={busy}
          onClick={() => onDecide('deny')}
        >
          Отклонить
        </button>
      </div>
    </div>
  )
}
