/** Сводка процессов, агентов в сети и таблицы запусков. */
import { useState } from 'react'
import { IconNodes, IconPlus } from '../components/Icons'
import { SetupModal } from '../components/SetupModal'
import { agentOnline, progress, statusLabel, taskTitle, when } from '../format'
import { useLive } from '../live'
import { href } from '../route'

export function WorkflowsPage() {
  const { ready, error, workflows, agents, runs, cursor } = useLive()
  const [setup, setSetup] = useState(false)
  const connected = cursor?.connected ?? false
  const online = agents.filter((agent) => agentOnline(agent, connected)).length

  return (
    <div className="page">
      <h1 className="page-title">Процессы</h1>
      {error ? <p className="banner">{error}</p> : null}
      {!ready && !error ? <p className="muted">Загрузка…</p> : null}
      <div className="dash">
        <div className="stack">
          <section className="card">
            <header className="card-head">
              <span>Процессы</span>
              <button type="button" className="icon-btn" aria-label="Новый процесс" onClick={() => setSetup(true)}>
                <IconPlus />
              </button>
            </header>
            {workflows.length === 0 ? (
              <div className="preview">
                <IconNodes className="preview-icon" />
                <strong>Создайте первый процесс</strong>
                <p>Добавьте шаги агентов и точки проверки, затем запускайте задачи.</p>
              </div>
            ) : (
              workflows.map((workflow) => (
                <a
                  key={workflow.id}
                  className="preview link"
                  href={href({ name: 'canvas', workflowId: workflow.id })}
                  data-testid="workflow-card"
                >
                  <span className="mini" aria-hidden="true">
                    {workflow.steps.map((step) => (
                      <span key={step.id} className="mini-node">
                        {step.title}
                      </span>
                    ))}
                  </span>
                  <strong>{workflow.name}</strong>
                  <p>{workflow.description}</p>
                </a>
              ))
            )}
          </section>
          <section className="card">
            <header className="card-head">
              <span>
                Агенты в сети <em className="count">{online}</em>
              </span>
              <a className="text-link" href={href({ name: 'agents' })}>
                Управление
              </a>
            </header>
            {agents.map((agent) => {
              const on = agentOnline(agent, connected)
              return (
                <a key={agent.id} className="agent-line" href={href({ name: 'agent', agentId: agent.id })}>
                  <span className={on ? 'presence' : 'presence off'} aria-hidden="true" />
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{on ? 'В сети' : 'Не подключён'}</small>
                  </span>
                </a>
              )
            })}
          </section>
        </div>
        <section className="card">
          <header className="card-head">
            <span>Запуски процессов</span>
            <a className="text-link" href={href({ name: 'runs' })}>
              Все запуски
            </a>
          </header>
          {runs.length === 0 ? (
            <p className="empty">Запусков ещё нет. Откройте процесс и отправьте задачу.</p>
          ) : (
            <div className="table-wrap">
              <table className="runs-table">
                <thead>
                  <tr>
                    <th>Процесс</th>
                    <th>Задача</th>
                    <th>Статус</th>
                    <th>Прогресс</th>
                    <th>Начат</th>
                    <th>Остановлен</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 8).map((run) => (
                    <tr key={run.id}>
                      <td>
                        <a href={href({ name: 'run', runId: run.id })}>{run.workflowName}</a>
                      </td>
                      <td>{taskTitle(run.task)}</td>
                      <td>
                        <span className={`pill ${run.status}`}>{statusLabel(run.status)}</span>
                      </td>
                      <td>{progress(run)}</td>
                      <td>{when(run.createdAt)}</td>
                      <td>{when(run.finishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {setup ? (
        <SetupModal
          initialName={workflows.length === 0 ? 'Сборка с проверкой' : 'Новый процесс'}
          onClose={() => setSetup(false)}
        />
      ) : null}
    </div>
  )
}
