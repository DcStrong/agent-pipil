/** Сводка процессов, агентов в сети и таблицы запусков. Пресет открывает готовую цепочку. */
import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { api, messageOf } from '../api'
import { IconNodes, IconPlus } from '../components/Icons'
import { SetupModal } from '../components/SetupModal'
import { agentOnline, isOpenRun, progress, statusLabel, taskTitle, when } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import type { PipelinePreset, Run, Workflow } from '../types'
import {
  bindPresetDraft,
  presetDraftWorkflowId,
  saveWorkflowDraft,
} from '../workflow-draft'

function workflowDeleteBlockReason(workflowId: string, runs: Run[]): string | null {
  const active = runs.some((run) => run.workflowId === workflowId && isOpenRun(run.status))
  if (active) return 'Сначала остановите или дождитесь завершения активного запуска.'
  return null
}

export function WorkflowsPage() {
  const { ready, error, workflows, agents, runs, cursor, presets, removeWorkflow, removePreset } = useLive()
  const [setup, setSetup] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [removingPreset, setRemovingPreset] = useState<string | null>(null)
  const [removingWorkflow, setRemovingWorkflow] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const busy = opening !== null || removingPreset !== null || removingWorkflow !== null
  const connected = cursor?.connected ?? false
  const online = agents.filter((agent) => agentOnline(agent, connected)).length

  async function openPreset(preset: PipelinePreset) {
    setOpening(preset.id)
    setActionError(null)
    try {
      const built = await api.presetSteps(preset.id)
      const workflowId = presetDraftWorkflowId(preset.id) ?? uuidv4()
      const workflow: Workflow = {
        id: workflowId,
        name: built.name,
        description: built.description,
        steps: built.steps,
      }
      saveWorkflowDraft(workflow)
      bindPresetDraft(preset.id, workflowId)
      window.location.hash = href({ name: 'canvas', workflowId })
    } catch (reason) {
      setActionError(messageOf(reason))
    } finally {
      setOpening(null)
    }
  }

  async function dropPreset(preset: PipelinePreset) {
    if (preset.builtin) return
    setRemovingPreset(preset.id)
    setActionError(null)
    try {
      await api.deletePreset(preset.id)
      removePreset(preset.id)
    } catch (reason) {
      setActionError(messageOf(reason))
    } finally {
      setRemovingPreset(null)
    }
  }

  async function dropWorkflow(workflow: Workflow) {
    if (workflowDeleteBlockReason(workflow.id, runs)) return
    setRemovingWorkflow(workflow.id)
    setActionError(null)
    try {
      await api.deleteWorkflow(workflow.id)
      removeWorkflow(workflow.id)
    } catch (reason) {
      setActionError(messageOf(reason))
    } finally {
      setRemovingWorkflow(null)
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Процессы</h1>
      {error ? <p className="banner">{error}</p> : null}
      {actionError ? <p className="banner">{actionError}</p> : null}
      {!ready && !error ? <p className="muted">Загрузка…</p> : null}
      {ready ? (
        <section className="card preset-board">
          <header className="card-head">
            <span>Пресеты</span>
          </header>
          <p className="preset-lead">
            Выберите имя — откроется холст с этой цепочкой. Чтобы процесс появился в списке ниже, сохраните его на холсте.
          </p>
          <div className="preset-grid">
            {presets.map((preset) => (
              <article key={preset.id} className="preset-tile" data-testid={`preset-tile-${preset.id}`}>
                <button
                  type="button"
                  className="preset-card"
                  data-testid={preset.id}
                  disabled={busy}
                  onClick={() => void openPreset(preset)}
                >
                  <strong>{preset.name}</strong>
                  <small>{preset.builtin ? 'Встроенный' : 'Свой'}</small>
                  <p>{preset.steps.map((step) => step.title).join(' → ')}</p>
                </button>
                {preset.builtin ? (
                  <p className="preset-guard" data-testid={`${preset.id}-remove-hint`}>
                    Встроенный пресет убрать нельзя.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="text-btn"
                    data-testid={`${preset.id}-remove`}
                    disabled={busy}
                    onClick={() => void dropPreset(preset)}
                  >
                    Убрать
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}
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
                <p>Добавьте шаги агентов и точки проверки. Задачи запускаются с доски.</p>
              </div>
            ) : (
              workflows.map((workflow) => {
                const blockReason = workflowDeleteBlockReason(workflow.id, runs)
                return (
                  <article key={workflow.id} className="workflow-tile" data-testid={`workflow-tile-${workflow.id}`}>
                    <a
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
                    {blockReason ? (
                      <p className="preset-guard" data-testid={`${workflow.id}-remove-hint`}>
                        {blockReason}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="text-btn"
                        data-testid={`${workflow.id}-remove`}
                        disabled={busy}
                        onClick={() => void dropWorkflow(workflow)}
                      >
                        Удалить
                      </button>
                    )}
                  </article>
                )
              })
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
