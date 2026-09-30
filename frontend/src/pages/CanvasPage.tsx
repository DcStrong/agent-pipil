/** Вертикальный холст: задача подсвечивает текущий шаг и может ждать подтверждения. */
import { LayoutGroup, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api'
import { finalText, statusLabel, taskTitle } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import type { AgentKind, StepMode, Workflow, WorkflowStep } from '../types'

const TASK_ROLES: AgentKind[] = ['orchestrator', 'analyst', 'architect', 'developer', 'tester']

export function CanvasPage({ workflowId }: { workflowId: string }) {
  const { ready, workflows, agents, runs, reload, upsertRun, upsertWorkflow } = useLive()
  const workflow = workflows.find((item) => item.id === workflowId)
  const [draft, setDraft] = useState<Workflow | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [task, setTask] = useState('Нужен массив объектов заказов')
  const [projectPath, setProjectPath] = useState('')
  const [mapPath, setMapPath] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [rolesReady, setRolesReady] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [missedId, setMissedId] = useState<string | null>(null)

  const signature = workflow
    ? JSON.stringify({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
      })
    : ''

  useEffect(() => {
    if (!workflow) return
    setDraft(structuredClone(workflow))
    setSelected((current) => current ?? workflow.steps[0]?.id ?? null)
  }, [signature])

  // Список мог ещё не содержать только что созданный процесс. Берём его с сервера, не показывая «не найден».
  useEffect(() => {
    if (!ready || workflow) return
    let cancel = false
    void api
      .workflow(workflowId)
      .then((item) => {
        if (!cancel) upsertWorkflow(item)
      })
      .catch(() => {
        if (!cancel) setMissedId(workflowId)
      })
    return () => {
      cancel = true
    }
  }, [ready, workflow, workflowId, upsertWorkflow])

  useEffect(() => {
    if (rolesReady) return
    const defaults = agents.filter((agent) => TASK_ROLES.includes(agent.kind) && agent.kind !== 'tester')
    if (defaults.length === 0) return
    setPicked(defaults.map((agent) => agent.id))
    setRolesReady(true)
  }, [agents, rolesReady])

  const live = runs.find(
    (run) =>
      run.workflowId === workflowId &&
      (run.status === 'running' || run.status === 'waiting_approval' || run.status === 'waiting_user'),
  )
  const latest = runs.find((run) => run.workflowId === workflowId)
  const shown = live ?? latest ?? null
  const locked = Boolean(live)

  const missing = missedId === workflowId && !workflow

  if (!ready || (!missing && (!workflow || !draft))) {
    return (
      <div className="page">
        <p className="muted">Загрузка…</p>
      </div>
    )
  }

  if (!workflow || !draft) {
    return (
      <div className="page">
        <p className="muted">Процесс не найден.</p>
        <a href={href({ name: 'workflows' })}>К процессам</a>
      </div>
    )
  }

  const steps = draft.steps
  const selectedStep = steps.find((step) => step.id === selected) ?? steps[0]
  const roleAgents = agents
    .filter((agent) => TASK_ROLES.includes(agent.kind))
    .sort((left, right) => TASK_ROLES.indexOf(left.kind) - TASK_ROLES.indexOf(right.kind))
  const roleRun = Boolean(shown?.steps.some((step) => TASK_ROLES.includes(step.kind)))
  const flowSource = live || roleRun ? shown : null
  const flow = flowSource
    ? flowSource.steps.map((step) => ({ id: step.stepId, title: step.title, mode: step.mode }))
    : roleAgents
        .filter((agent) => picked.includes(agent.id))
        .map((agent) => ({
          id: agent.id,
          title: agent.name,
          mode: (agent.kind === 'architect' ? 'question' : 'automatic') as StepMode,
        }))
  const openedStep = flowSource?.steps.find((step) => step.stepId === opened) ?? null

  function patchStep(id: string, patch: Partial<WorkflowStep>) {
    setDraft((current) => {
      if (!current) return current
      return {
        ...current,
        steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
      }
    })
  }

  function move(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current
      const target = index + direction
      if (target < 0 || target >= current.steps.length) return current
      const next = current.steps.slice()
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return { ...current, steps: fillHandoffs(next) }
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.saveWorkflow(draft.id, {
        name: draft.name,
        description: draft.description,
        steps: fillHandoffs(draft.steps),
      })
      await reload()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const run = await api.startRun(workflowId, task, {
        roleIds: picked,
        projectPath: projectPath.trim(),
        mapPath: mapPath.trim(),
      })
      upsertRun(run)
      setOpened(run.steps[0]?.stepId ?? null)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function sendAnswer() {
    if (!live) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.answer(live.id, answer))
      setAnswer('')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!live) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.decide(live.id, decision))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const activeStepId =
    live && live.stepIndex !== null ? live.steps[live.stepIndex]?.stepId ?? null : null

  return (
    <div className="canvas-page">
      <div className="stage">
        <div className="stage-inner">
          <a className="crumb" href={href({ name: 'workflows' })}>
            Процессы
          </a>
          <LayoutGroup>
            <div className="flow" data-testid="canvas">
              {flowSource ? (
                <>
                  <div className="flow-row">
                    <div className="node task-pill">
                      <span className="node-title">{taskTitle(flowSource.task)}</span>
                      <span className="chev">›</span>
                    </div>
                    <div className="badge-slot" />
                  </div>
                  <div className="link-row">
                    <i />
                  </div>
                </>
              ) : null}
              {flow.map((step, index) => {
                const active = activeStepId === step.id
                const done = Boolean(flowSource?.work.some((item) => item.stepId === step.id) && !active)
                return (
                  <div key={step.id}>
                    <div className="flow-row">
                      <button
                        type="button"
                        className={[
                          'node',
                          active ? 'is-active' : '',
                          done ? 'is-done' : '',
                          selectedStep?.id === step.id ? 'is-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          if (steps.some((item) => item.id === step.id)) setSelected(step.id)
                          setOpened(step.id)
                        }}
                        data-testid={active ? 'active-step' : `step-${step.id}`}
                      >
                        <StepMark index={index} />
                        <span className="node-title">{step.title}</span>
                        {step.mode === 'approval' ? <span className="mode-chip">проверка</span> : null}
                        {step.mode === 'question' ? <span className="mode-chip">вопрос</span> : null}
                        <span className="chev">›</span>
                      </button>
                      <div className="badge-slot">
                        {active && live ? (
                          <motion.span
                            layoutId="live-badge"
                            className={live.status === 'waiting_approval' ? 'badge wait' : 'badge'}
                          >
                            {live.status === 'waiting_approval'
                              ? 'Ждёт подтверждения'
                              : live.status === 'waiting_user'
                                ? 'Ждёт ответа'
                                : 'Выполняется'}
                          </motion.span>
                        ) : null}
                      </div>
                    </div>
                    <div className="link-row">
                      <i />
                    </div>
                  </div>
                )
              })}
              {live ? (
                <div className="flow-row">
                  <div className="node status-pill">
                    <span className="spark" aria-hidden="true">
                      ✦
                    </span>
                    {statusLabel(live.status)}
                  </div>
                  <div className="badge-slot" />
                </div>
              ) : null}
            </div>
          </LayoutGroup>
        </div>
      </div>
      <aside className="side">
        <label className="field">
          <span>Процесс</span>
          <input
            value={draft.name}
            disabled={locked}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Описание</span>
          <textarea
            value={draft.description}
            disabled={locked}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <div className="roles">
          <span className="kicker">Роли задачи</span>
          {roleAgents.map((agent) => (
            <label key={agent.id}>
              <input
                type="checkbox"
                data-testid={`role-${agent.kind}`}
                checked={picked.includes(agent.id)}
                onChange={(event) => {
                  setPicked((current) =>
                    event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id),
                  )
                }}
              />
              {agent.name}
            </label>
          ))}
        </div>
        <label className="field">
          <span>Папка проекта</span>
          <input
            data-testid="project-path"
            value={projectPath}
            placeholder="Путь к папке"
            onChange={(event) => setProjectPath(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Карта, если уже есть</span>
          <input
            data-testid="map-path"
            value={mapPath}
            placeholder="Необязательный путь"
            onChange={(event) => setMapPath(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Задача</span>
          <textarea data-testid="task-input" value={task} onChange={(event) => setTask(event.target.value)} />
        </label>
        <button
          type="button"
          className="primary wide"
          data-testid="start-run"
          disabled={busy || locked || !task.trim() || picked.length === 0}
          onClick={() => void start()}
        >
          Запустить
        </button>
        {live ? (
          <p className="now" data-testid="run-status">
            Сейчас: {live.steps[live.stepIndex ?? 0]?.title ?? '—'} · {statusLabel(live.status)}
          </p>
        ) : null}
        {live?.status === 'waiting_user' ? (
          <div className="decision">
            <p>Роль задала вопрос. Оркестратор за вас не отвечает, конвейер стоит.</p>
            <p data-testid="pending-question">{live.pendingQuestion}</p>
            <label className="field">
              <span>Ответ</span>
              <textarea data-testid="user-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
            </label>
            <button type="button" className="primary" data-testid="send-answer" disabled={busy || !answer.trim()} onClick={() => void sendAnswer()}>
              Ответить
            </button>
          </div>
        ) : null}
        {openedStep ? (
          <section className="dialogue" data-testid="dialogue">
            <h2>Диалог · {openedStep.title}</h2>
            {openedStep.messages.length === 0 ? <p className="hint">Реплик пока нет.</p> : null}
            {openedStep.messages.map((message) => (
              <p key={message.id} className={`bubble ${message.author}`}>
                {message.text}
              </p>
            ))}
          </section>
        ) : null}
        {shown?.project ? (
          <p className="hint">
            Проект: {shown.project.folder ?? 'не задан'}. Правила, навыки и команды берутся из .cursor по путям
            {shown.project.rules.length + shown.project.skills.length + shown.project.commands.length
              ? `: ${[...shown.project.rules, ...shown.project.skills, ...shown.project.commands].join(', ')}`
              : ' и в сообщения не копируются'}
            .
            {shown.mapNote ? ` ${shown.mapNote}` : ''}
          </p>
        ) : null}
        {live?.status === 'waiting_approval' ? (
          <div className="decision">
            <p>Шаг ждёт вашего подтверждения. Пока вы не решите, задача не идёт дальше.</p>
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
        {shown?.status === 'completed' && shown.finalResult ? (
          <article className="result" data-testid="final-result">
            <h2>Итог</h2>
            <p>{finalText(shown.finalResult)}</p>
          </article>
        ) : null}
        {shown?.status === 'failed' && shown.error ? <p className="error-line">{shown.error}</p> : null}
        {error ? <p className="error-line">{error}</p> : null}
        {selectedStep ? (
          <section className="editor">
            <h2>Шаг</h2>
            <label className="field">
              <span>Название</span>
              <input
                value={selectedStep.title}
                disabled={locked}
                onChange={(event) => patchStep(selectedStep.id, { title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Агент</span>
              <select
                value={selectedStep.agentId}
                disabled={locked}
                onChange={(event) => patchStep(selectedStep.id, { agentId: event.target.value })}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Режим</span>
              <select
                value={selectedStep.mode}
                disabled={locked}
                onChange={(event) => patchStep(selectedStep.id, { mode: event.target.value as StepMode })}
              >
                <option value="automatic">Автоматически</option>
                <option value="question">Ждёт ответа</option>
                <option value="approval">Ждёт подтверждения</option>
              </select>
            </label>
            <label className="field">
              <span>Передача следующему</span>
              <textarea
                value={selectedStep.handoff}
                disabled={locked}
                onChange={(event) => patchStep(selectedStep.id, { handoff: event.target.value })}
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                disabled={locked || steps[0]?.id === selectedStep.id}
                onClick={() => move(steps.findIndex((step) => step.id === selectedStep.id), -1)}
              >
                Выше
              </button>
              <button
                type="button"
                disabled={locked || steps[steps.length - 1]?.id === selectedStep.id}
                onClick={() => move(steps.findIndex((step) => step.id === selectedStep.id), 1)}
              >
                Ниже
              </button>
              <button
                type="button"
                disabled={locked || steps.length < 2}
                onClick={() =>
                  setDraft({
                    ...draft,
                    steps: fillHandoffs(steps.filter((step) => step.id !== selectedStep.id)),
                  })
                }
              >
                Удалить
              </button>
            </div>
          </section>
        ) : null}
        <div className="row-actions">
          <button
            type="button"
            disabled={locked || agents.length === 0}
            onClick={() =>
              setDraft({
                ...draft,
                steps: fillHandoffs([
                  ...steps.map((step, index) =>
                    index === steps.length - 1 && !step.handoff.trim()
                      ? { ...step, handoff: 'Передай результат следующему шагу.' }
                      : step,
                  ),
                  {
                    id: crypto.randomUUID(),
                    agentId: agents[0]?.id ?? '',
                    title: 'Шаг',
                    mode: 'automatic',
                    handoff: '',
                  },
                ]),
              })
            }
          >
            Добавить шаг
          </button>
          <button type="button" className="primary" disabled={busy || locked} onClick={() => void save()}>
            Сохранить процесс
          </button>
        </div>
      </aside>
    </div>
  )
}

function fillHandoffs(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((step, index) => {
    const last = index === steps.length - 1
    if (!last && !step.handoff.trim()) {
      return { ...step, handoff: 'Передай результат следующему шагу.' }
    }
    return step
  })
}

function StepMark({ index }: { index: number }) {
  const label = index === 0 ? '✶' : index === 1 ? '{' : '⌕'
  return (
    <span className="step-mark" aria-hidden="true">
      {label}
    </span>
  )
}
