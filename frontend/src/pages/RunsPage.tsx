/** Список всех запусков: статус, число шагов и время. */
import { useMemo, useState } from 'react'
import { api, messageOf } from '../api'
import { DarkSelect } from '../components/DarkSelect'
import { IconCheck, IconSpark } from '../components/Icons'
import { progress, taskTitle, when } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import type { RunStatus } from '../types'

const filters: Array<{ id: 'all' | RunStatus; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'running', label: 'Выполняется' },
  { id: 'waiting_approval', label: 'Ждёт подтверждения' },
  { id: 'waiting_plan', label: 'Можно править план' },
  { id: 'completed', label: 'Готово' },
  { id: 'failed', label: 'Ошибка' },
]

export function RunsPage() {
  const { runs, removeRun } = useLive()
  const [filter, setFilter] = useState<(typeof filters)[number]['id']>('all')
  const [error, setError] = useState<string | null>(null)
  const visible = useMemo(
    () => (filter === 'all' ? runs : runs.filter((run) => run.status === filter)),
    [runs, filter],
  )

  async function dropRun(id: string) {
    if (!window.confirm('Удалить этот запуск? Задача на доске останется.')) return
    setError(null)
    try {
      await api.deleteRun(id)
      removeRun(id)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page narrow">
      <header className="list-head">
        <h1 className="page-title">
          Все запуски <em className="count">{runs.length}</em>
        </h1>
        <div className="filter">
          <span className="sr">Фильтр</span>
          <DarkSelect
            testId="runs-filter"
            value={filter}
            options={filters.map((item) => ({ value: item.id, label: item.label }))}
            onChange={(value) => setFilter(value as (typeof filters)[number]['id'])}
          />
        </div>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      {visible.length === 0 ? <p className="empty">Таких запусков нет.</p> : null}
      <ul className="run-list">
        {visible.map((run) => (
          <li key={run.id} className="run-list-item">
            <a className="run-row" href={href({ name: 'run', runId: run.id })}>
              <StatusGlyph status={run.status} />
              <span className="run-copy">
                <strong>{taskTitle(run.task)}</strong>
                <small>
                  {progress(run)} {stepsWord(run.steps.length)}
                </small>
              </span>
              <time>{when(run.updatedAt)}</time>
            </a>
            <button
              type="button"
              className="text-btn danger run-delete"
              data-testid={`delete-run-${run.id}`}
              onClick={() => void dropRun(run.id)}
            >
              Удалить
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function stepsWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'шаг'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'шага'
  return 'шагов'
}

function StatusGlyph({ status }: { status: RunStatus }) {
  if (status === 'completed') return <IconCheck className="glyph ok" />
  if (status === 'failed') return <span className="glyph bad" aria-hidden="true" />
  return (
    <IconSpark
      className={status === 'waiting_approval' || status === 'waiting_plan' ? 'glyph wait' : 'glyph run'}
    />
  )
}
