/** Холст процесса: шаги образуют дерево, один агент может стоять несколько раз. */
import { LayoutGroup, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api, messageOf } from '../api'
import { AccessPrompt } from '../components/AccessPrompt'
import { DialogueLines, dialogueIsRunning } from '../components/DialogueLines'
import { DarkSelect } from '../components/DarkSelect'
import { TaskExamples, type ExampleId } from '../components/TaskExamples'
import { ResumeRun } from '../components/ResumeRun'
import { TaskOrderPanel } from '../components/TaskOrderPanel'
import { canResumeRun, finalText, isOpenRun, statusLabel, taskTitle } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import { hasCycle, materialize, orderSteps, withHandoffs } from '../step-graph'
import { v4 as uuidv4 } from 'uuid'
import type { AccessDecision, Agent, AgentKind, Run, StepMode, TaskPlan, Workflow, WorkflowStep } from '../types'
import {
  isWorkflowDraft,
  loadWorkflowDraft,
  removeWorkflowDraft,
  saveWorkflowDraft,
} from '../workflow-draft'

const TASK_ROLES: AgentKind[] = ['orchestrator', 'analyst', 'architect', 'developer', 'tester']

const MODE_OPTIONS = [
  { value: 'automatic', label: 'Автоматически' },
  { value: 'question', label: 'Ждёт ответа' },
  { value: 'approval', label: 'Ждёт подтверждения' },
  { value: 'ask', label: 'Смотреть' },
  { value: 'plan', label: 'План' },
  { value: 'build', label: 'Сборка' },
  { value: 'review', label: 'Сверка' },
]

export function CanvasPage({ workflowId }: { workflowId: string }) {
  const { ready, workflows, agents, runs, presets, reload, upsertRun, upsertWorkflow, upsertPreset, removePreset } =
    useLive()
  const persisted = workflows.find((item) => item.id === workflowId)
  const workflow = persisted ?? loadWorkflowDraft(workflowId)
  const isDraft = isWorkflowDraft(workflowId) && !persisted
  const [draft, setDraft] = useState<Workflow | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [linking, setLinking] = useState(false)
  const [placeAgentId, setPlaceAgentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [missedId, setMissedId] = useState<string | null>(null)
  const [picked, setPicked] = useState('')
  const [presetName, setPresetName] = useState('')
  const [presetNote, setPresetNote] = useState<string | null>(null)
  /** Какой пример последний применили к цепочке. */
  const [example, setExample] = useState<ExampleId | null>(null)

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
    if (!ready || workflow || isWorkflowDraft(workflowId)) return
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

  const live = runs.find((run) => run.workflowId === workflowId && isOpenRun(run.status))
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
  const pickedId = presets.some((item) => item.id === picked) ? picked : (presets[0]?.id ?? '')
  const pickedPreset = presets.find((item) => item.id === pickedId)
  const graph = materialize(steps)
  const byId = new Map(graph.map((step) => [step.id, step]))
  const selectedStep = graph.find((step) => step.id === selected) ?? graph[0]
  const palette = [...agents].sort((left, right) => agentRank(left.kind) - agentRank(right.kind) || left.name.localeCompare(right.name, 'ru'))
  const roleAgents = palette.filter((agent) => TASK_ROLES.includes(agent.kind))
  const pickedRoleIds = roleAgents.filter((agent) => steps.some((step) => step.agentId === agent.id)).map((agent) => agent.id)
  const placeAgent = palette.find((agent) => agent.id === (placeAgentId || palette[0]?.id)) ?? palette[0]
  const openedStep = shown?.steps.find((step) => step.stepId === opened) ?? null
  const incoming = new Set<string>()
  for (const step of graph) {
    for (const id of step.nextIds) incoming.add(id)
  }
  const roots = graph.filter((step) => !incoming.has(step.id))

  function commit(next: WorkflowStep[], selectId?: string) {
    if (hasCycle(next)) {
      setError('Связь замыкает конвейер.')
      setLinking(false)
      return
    }
    setError(null)
    setDraft((current) => (current ? { ...current, steps: withHandoffs(next) } : current))
    if (selectId) setSelected(selectId)
  }

  function place(agent: Agent, how: 'sequence' | 'branch', where: 'selected' | 'tail' = 'selected') {
    if (locked) return
    const base = materialize(steps)
    const id = uuidv4()
    const created: WorkflowStep = {
      id,
      agentId: agent.id,
      title: agent.name,
      mode: agent.kind === 'architect' ? 'question' : agent.kind === 'reviewer' ? 'approval' : 'automatic',
      handoff: '',
      nextIds: [],
    }
    const anchor =
      where === 'tail'
        ? orderSteps(base).at(-1)
        : base.find((step) => step.id === selected) ?? orderSteps(base).at(-1)
    if (!anchor) {
      commit([created], id)
      return
    }
    if (how === 'branch') {
      commit(
        [
          ...base.map((step) => (step.id === anchor.id ? { ...step, nextIds: [...step.nextIds, id] } : step)),
          created,
        ],
        id,
      )
      return
    }
    created.nextIds = [...anchor.nextIds]
    commit(
      [...base.map((step) => (step.id === anchor.id ? { ...step, nextIds: [id] } : step)), created],
      id,
    )
  }

  /** Пример подставляет роли в цепочку. Задачи с доски сюда не запускаются. */
  function applyExample(exampleId: ExampleId, nextPicked: string[]) {
    setExample(exampleId)
    if (locked) return
    const wanted = new Set(nextPicked)
    const roleIds = new Set(roleAgents.map((agent) => agent.id))
    const original = materialize(steps)
    const dropping = new Set(
      original.filter((step) => roleIds.has(step.agentId) && !wanted.has(step.agentId)).map((step) => step.id),
    )
    const missing = roleAgents.filter(
      (agent) => wanted.has(agent.id) && !original.some((step) => step.agentId === agent.id && !dropping.has(step.id)),
    )
    if (original.length - dropping.size + missing.length < 1) {
      setError('В процессе нужен хотя бы один шаг.')
      return
    }
    if (dropping.size === 0 && missing.length === 0) return
    let next = original
      .filter((step) => !dropping.has(step.id))
      .map((step) => ({
        ...step,
        nextIds: step.nextIds.flatMap((id) => {
          if (!dropping.has(id)) return [id]
          const removed = original.find((item) => item.id === id)
          return (removed?.nextIds ?? []).filter((child) => !dropping.has(child) && child !== step.id)
        }),
      }))
    let addedId: string | undefined
    for (const agent of missing) {
      const id = uuidv4()
      addedId = id
      const created: WorkflowStep = {
        id,
        agentId: agent.id,
        title: agent.name,
        mode: agent.kind === 'architect' ? 'question' : agent.kind === 'reviewer' ? 'approval' : 'automatic',
        handoff: '',
        nextIds: [],
      }
      const anchor = orderSteps(next).at(-1)
      if (!anchor) {
        next = [created]
        continue
      }
      created.nextIds = [...anchor.nextIds]
      next = [...next.map((step) => (step.id === anchor.id ? { ...step, nextIds: [id] } : step)), created]
    }
    const selectId = addedId ?? (selected && !dropping.has(selected) ? selected : next[0]?.id)
    commit(next, selectId)
  }

  function connect(toId: string) {
    if (!selected || selected === toId || locked) return
    const base = materialize(steps)
    commit(
      base.map((step) =>
        step.id === selected ? { ...step, nextIds: [...new Set([...step.nextIds, toId])] } : step,
      ),
    )
    setLinking(false)
  }

  function unlink(childId: string) {
    if (!selected || locked) return
    const base = materialize(steps)
    commit(
      base.map((step) =>
        step.id === selected ? { ...step, nextIds: step.nextIds.filter((id) => id !== childId) } : step,
      ),
    )
  }

  function removeStepBlockReason(): string | null {
    if (locked) return 'Пока идёт запуск, шаг не убирают.'
    if (!selectedStep) return 'Сначала выберите шаг на холсте.'
    if (graph.length < 2) return 'В процессе нужен хотя бы один шаг.'
    return null
  }

  function removeSelected() {
    if (removeStepBlockReason()) return
    const base = materialize(steps)
    const dropping = selectedStep!.id
    const kept = base
      .filter((step) => step.id !== dropping)
      .map((step) => ({
        ...step,
        nextIds: step.nextIds.flatMap((id) => (id === dropping ? selectedStep!.nextIds : [id])),
      }))
    const parent = base.find((step) => step.nextIds.includes(dropping))
    commit(kept, parent?.id ?? kept[0]?.id)
  }

  async function save() {
    if (!draft) return
    const source = draft
    const next = withHandoffs(materialize(source.steps))
    setBusy(true)
    setError(null)
    try {
      const saved = isDraft
        ? await api.publishWorkflow({
            name: source.name,
            description: source.description,
            steps: next,
          })
        : await api.saveWorkflow(source.id, {
            name: source.name,
            description: source.description,
            steps: next,
          })
      if (isDraft) {
        removeWorkflowDraft(source.id)
      }
      upsertWorkflow(saved)
      if (isDraft && saved.id !== source.id) {
        window.location.replace(href({ name: 'canvas', workflowId: saved.id }))
      }
      await reload()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Ставит выбранную цепочку на открытый холст. Сеть Cursor при этом не вызывается. */
  async function applyPreset() {
    const source = draft
    if (!pickedId || !source || locked) return
    setBusy(true)
    setError(null)
    setPresetNote(null)
    try {
      const built = await api.presetSteps(pickedId)
      setLinking(false)
      setDraft({
        ...source,
        name: built.name,
        description: built.description,
        steps: built.steps,
      })
      setSelected(built.steps[0]?.id ?? null)
      setOpened(null)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  /** Запоминает текущее дерево под новым именем, чтобы открыть его в следующий раз. */
  async function savePreset() {
    const source = draft
    if (!source) return
    const next = withHandoffs(materialize(source.steps))
    setBusy(true)
    setError(null)
    setPresetNote(null)
    try {
      const preset = await api.createPreset({
        name: presetName,
        steps: next.map((step) => ({
          key: step.id,
          agentId: step.agentId,
          title: step.title,
          mode: step.mode,
          handoff: step.handoff,
          nextKeys: step.nextIds,
        })),
      })
      upsertPreset(preset)
      setPicked(preset.id)
      setPresetName('')
      setPresetNote(`Пресет «${preset.name}» сохранён. Его можно выбрать в списке.`)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function dropPreset() {
    const current = presets.find((item) => item.id === pickedId)
    if (!current || current.builtin || locked) return
    setBusy(true)
    setError(null)
    setPresetNote(null)
    try {
      await api.deletePreset(current.id)
      removePreset(current.id)
      setPicked(presets.find((item) => item.id !== current.id)?.id ?? '')
      setPresetNote(`Пресет «${current.name}» удалён.`)
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

  async function savePlan(plan: TaskPlan) {
    if (!live) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.saveRunPlan(live.id, plan))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function grant(decision: AccessDecision) {
    if (!live) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.grantAccess(live.id, decision))
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

  async function resumeShown(mode: 'continue' | 'retry') {
    if (!shown || !canResumeRun(shown)) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.resumeRun(shown.id, mode))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function stopLive() {
    if (!live) return
    setBusy(true)
    setError(null)
    try {
      upsertRun(await api.stop(live.id))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  function continueLive() {
    if (!live) return
    if (live.status === 'running') {
      window.location.hash = href({ name: 'run', runId: live.id })
      return
    }
    document.querySelector('[data-testid="run-wait"]')?.scrollIntoView({ block: 'center' })
  }

  const activeStepId = live && live.stepIndex !== null ? live.steps[live.stepIndex]?.stepId ?? null : null
  const doneIds = new Set((shown?.work ?? []).map((item) => item.stepId))
  const removeBlocked = selectedStep ? removeStepBlockReason() : null

  return (
    <div className="canvas-page">
      <div className="stage">
        <div className="stage-inner">
          <a className="crumb" href={href({ name: 'workflows' })}>
            Процессы
          </a>
          <LayoutGroup>
            {shown ? (
              <div className="node task-pill">
                <span className="node-title">{taskTitle(shown.task)}</span>
              </div>
            ) : null}
            <div className="tree" data-testid="canvas">
              {roots.map((step) => (
                <Branch
                  key={step.id}
                  step={step}
                  byId={byId}
                  trail={new Set()}
                  activeId={activeStepId}
                  doneIds={doneIds}
                  selectedId={selectedStep?.id ?? null}
                  linking={linking}
                  live={live ?? null}
                  onPick={(id) => {
                    if (linking && selected && selected !== id) {
                      connect(id)
                      return
                    }
                    setSelected(id)
                    setOpened(id)
                  }}
                />
              ))}
            </div>
            {live ? (
              <div className="node status-pill">
                <span className="spark" aria-hidden="true">
                  ✦
                </span>
                {statusLabel(live.status)}
              </div>
            ) : null}
          </LayoutGroup>
        </div>
      </div>
      <aside className="side">
        {live ? (
          <BusyRunNotice run={live} busy={busy} onContinue={continueLive} onStop={() => void stopLive()} />
        ) : null}
        <section className="preset-box" data-testid="preset-panel">
          <h2>Пресет</h2>
          <p className="hint">Готовая цепочка по имени. Текущее дерево можно сохранить и открыть снова.</p>
          {pickedPreset ? (
            <DarkSelect
              testId="preset-pick"
              value={pickedPreset.id}
              disabled={locked || busy}
              options={presets.map((item) => ({ value: item.id, label: item.name }))}
              onChange={setPicked}
            />
          ) : (
            <p className="hint">Пресетов пока нет.</p>
          )}
          {pickedPreset ? (
            <p className="hint" data-testid="preset-preview">
              {pickedPreset.steps.map((step) => step.title).join(' → ')}
            </p>
          ) : null}
          <div className="row-actions">
            <button
              type="button"
              data-testid="apply-preset"
              disabled={busy || locked || !pickedPreset}
              onClick={() => void applyPreset()}
            >
              Поставить на холст
            </button>
            {pickedPreset && !pickedPreset.builtin ? (
              <button type="button" className="text-btn" data-testid="delete-preset" disabled={busy || locked} onClick={() => void dropPreset()}>
                Удалить
              </button>
            ) : null}
          </div>
          <label className="field">
            <span>Имя своего пресета</span>
            <input
              data-testid="preset-name"
              value={presetName}
              disabled={locked}
              maxLength={80}
              placeholder="Например, Выкладка"
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="save-preset"
            disabled={busy || locked || !presetName.trim() || steps.length === 0}
            onClick={() => void savePreset()}
          >
            Сохранить пресет
          </button>
          {presetNote ? <p className="ok-line">{presetNote}</p> : null}
        </section>
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
        <div className="roles" data-testid="roles-panel">
          <span className="kicker">Роли задачи</span>
          {live ? (
            <BusyRunNotice run={live} busy={busy} onContinue={continueLive} onStop={() => void stopLive()} />
          ) : null}
          {palette.map((agent) => (
            <div className="role-row" key={agent.id}>
              <span className="role-name">{agent.name}</span>
              <button
                type="button"
                className="text-btn"
                data-testid={
                  TASK_ROLES.includes(agent.kind) ? `role-more-${agent.kind}` : `role-more-${agent.id}`
                }
                disabled={locked}
                onClick={() => place(agent, 'sequence')}
              >
                Ещё
              </button>
            </div>
          ))}
        </div>
        <TaskExamples agents={roleAgents} picked={pickedRoleIds} active={example} onApply={applyExample} />
        <div className="editor" data-testid="place-panel">
          <h2>Поставить на холст</h2>
          <p className="hint">«Следом» вставляет шаг в цепочку. «Ответвить» ведёт вторую ветку от выбранного шага.</p>
          {placeAgent ? (
            <DarkSelect
              testId="place-agent"
              value={placeAgent.id}
              disabled={locked}
              options={palette.map((agent) => ({ value: agent.id, label: agent.name }))}
              onChange={setPlaceAgentId}
            />
          ) : null}
          {live ? (
            <BusyRunNotice run={live} busy={busy} onContinue={continueLive} onStop={() => void stopLive()} />
          ) : null}
          <div className="row-actions">
            <button type="button" data-testid="place-next" disabled={locked || !placeAgent} onClick={() => placeAgent && place(placeAgent, 'sequence')}>
              Следом
            </button>
            <button type="button" data-testid="place-branch" disabled={locked || !placeAgent} onClick={() => placeAgent && place(placeAgent, 'branch')}>
              Ответвить
            </button>
          </div>
        </div>
        <p className="hint" data-testid="canvas-config-hint">
          Здесь настраивается только цепочка. Новую задачу создайте на доске и перенесите в работу.
        </p>
        {live ? (
          <p className="now" data-testid="run-status">
            Сейчас: {live.steps[live.stepIndex ?? 0]?.title ?? '—'} · {statusLabel(live.status)}
          </p>
        ) : null}
        {shown?.deepThinking ? (
          <div data-testid={live?.status === 'waiting_plan' ? 'run-wait' : undefined}>
            <TaskOrderPanel run={live ?? shown} busy={busy} onSave={savePlan} />
          </div>
        ) : null}
        {live?.status === 'waiting_user' ? (
          <div className="decision" data-testid="run-wait">
            <p>Роль задала вопрос. Оркестратор за вас не отвечает, конвейер стоит.</p>
            <p data-testid="pending-question">{live.pendingQuestion}</p>
            <label className="field">
              <span>Ответ</span>
              <textarea
                data-testid="user-answer"
                value={answer}
                placeholder="Ответ на вопрос роли"
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <div className="row-actions">
              <button type="button" className="primary decision-btn" data-testid="send-answer" disabled={busy || !answer.trim()} onClick={() => void sendAnswer()}>
                Ответить
              </button>
              <button type="button" className="decision-btn" data-testid="reject-question" disabled={busy} onClick={() => void decide('reject')}>
                Отклонить
              </button>
            </div>
          </div>
        ) : null}
        {openedStep ? (
          <section className="dialogue" data-testid="dialogue">
            <h2>Диалог · {openedStep.title}</h2>
            <DialogueLines
              messages={openedStep.messages}
              running={dialogueIsRunning(
                live?.status,
                live?.stepIndex != null && live.steps[live.stepIndex]?.stepId === openedStep.stepId,
              )}
            />
          </section>
        ) : (
          <p className="hint" data-testid="dialogue-hint">
            Нажмите роль на холсте, чтобы посмотреть её диалог по уже идущему запуску. Новые задачи начинаются с доски.
          </p>
        )}
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
        {live?.status === 'waiting_access' ? (
          <AccessPrompt run={live} busy={busy} onDecide={(decision) => void grant(decision)} />
        ) : null}
        {live?.status === 'waiting_approval' ? (
          <div className="decision" data-testid="run-wait">
            <p>Шаг ждёт вашего подтверждения. Пока вы не решите, задача не идёт дальше.</p>
            <div className="row-actions">
              <button type="button" className="primary decision-btn" data-testid="approve" disabled={busy} onClick={() => void decide('approve')}>
                Одобрить
              </button>
              <button type="button" className="decision-btn" data-testid="reject" disabled={busy} onClick={() => void decide('reject')}>
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
        {shown && canResumeRun(shown) ? (
          <ResumeRun run={shown} busy={busy} onResume={(mode) => void resumeShown(mode)} />
        ) : shown?.status === 'failed' && shown.error ? (
          <p className="error-line">{shown.error}</p>
        ) : null}
        {error ? <p className="error-line">{error}</p> : null}
        {selectedStep ? (
          <section className="editor">
            <h2>Шаг</h2>
            <label className="field">
              <span>Название</span>
              <input
                value={selectedStep.title}
                disabled={locked}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    steps: steps.map((step) => (step.id === selectedStep.id ? { ...step, title: event.target.value } : step)),
                  })
                }
              />
            </label>
            <div className="field">
              <span>Агент</span>
              <DarkSelect
                value={selectedStep.agentId}
                disabled={locked}
                options={palette.map((agent) => ({ value: agent.id, label: agent.name }))}
                onChange={(agentId) =>
                  setDraft({
                    ...draft,
                    steps: steps.map((step) => (step.id === selectedStep.id ? { ...step, agentId } : step)),
                  })
                }
              />
            </div>
            <div className="field">
              <span>Режим</span>
              <DarkSelect
                value={selectedStep.mode}
                disabled={locked}
                options={MODE_OPTIONS}
                onChange={(mode) =>
                  setDraft({
                    ...draft,
                    steps: steps.map((step) =>
                      step.id === selectedStep.id ? { ...step, mode: mode as StepMode } : step,
                    ),
                  })
                }
              />
            </div>
            <label className="field">
              <span>Передача следующему</span>
              <textarea
                value={selectedStep.handoff}
                disabled={locked}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    steps: steps.map((step) =>
                      step.id === selectedStep.id ? { ...step, handoff: event.target.value } : step,
                    ),
                  })
                }
              />
            </label>
            <p className="hint">Связи этого шага. Сосед выбирается на холсте.</p>
            <ul className="link-list">
              {selectedStep.nextIds.length === 0 ? <li className="muted">Дальше никого нет.</li> : null}
              {selectedStep.nextIds.map((id) => (
                <li key={id}>
                  <span>{byId.get(id)?.title ?? 'Шаг'}</span>
                  <button type="button" className="text-btn" disabled={locked} onClick={() => unlink(id)}>
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
            <div className="row-actions">
              <button
                type="button"
                data-testid="link-step"
                disabled={locked}
                onClick={() => setLinking((current) => !current)}
              >
                {linking ? 'Выберите шаг на холсте' : 'Связать с соседом'}
              </button>
            </div>
            <div className="row-actions" data-testid="remove-step-row">
              <button
                type="button"
                data-testid="remove-step"
                disabled={Boolean(removeBlocked)}
                onClick={removeSelected}
              >
                Убрать шаг
              </button>
              {removeBlocked ? (
                <p className="hint" data-testid="remove-step-reason">
                  {removeBlocked}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
        <div className="row-actions">
          <button type="button" className="primary" disabled={busy || locked} onClick={() => void save()}>
            Сохранить процесс
          </button>
        </div>
      </aside>
    </div>
  )
}

/** Занятый запуск. Панель длинная: верхнее предупреждение уезжает, поэтому то же самое стоит у ролей и у «Следом». */
function BusyRunNotice({
  run,
  busy,
  onContinue,
  onStop,
}: {
  run: Run
  busy: boolean
  onContinue: () => void
  onStop: () => void
}) {
  return (
    <section className="busy-run" data-testid="canvas-busy">
      <p>
        Процесс занят: запуск «{taskTitle(run.task)}» ещё идёт. Пока он не закончится, холст не правится.
      </p>
      <div className="row-actions">
        <a className="busy-link" data-testid="busy-open" href={href({ name: 'run', runId: run.id })}>
          Открыть
        </a>
        <button type="button" data-testid="busy-continue" onClick={onContinue}>
          Продолжить
        </button>
        <button type="button" data-testid="busy-stop" disabled={busy} onClick={onStop}>
          Остановить
        </button>
      </div>
    </section>
  )
}

function Branch({
  step,
  byId,
  trail,
  activeId,
  doneIds,
  selectedId,
  linking,
  live,
  onPick,
}: {
  step: WorkflowStep
  byId: Map<string, WorkflowStep>
  trail: Set<string>
  activeId: string | null
  doneIds: Set<string>
  selectedId: string | null
  linking: boolean
  live: Run | null
  onPick: (id: string) => void
}) {
  if (trail.has(step.id)) return null
  const nextTrail = new Set(trail)
  nextTrail.add(step.id)
  const children = step.nextIds.map((id) => byId.get(id)).filter((item): item is WorkflowStep => Boolean(item))
  const active = activeId === step.id
  const done = doneIds.has(step.id) && !active
  return (
    <div className="branch">
      <button
        type="button"
        className={[
          'node',
          'branch-node',
          active ? 'is-active' : '',
          done ? 'is-done' : '',
          selectedId === step.id ? 'is-selected' : '',
          linking && selectedId !== step.id ? 'is-target' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onPick(step.id)}
        data-testid={active ? 'active-step' : `step-${step.id}`}
      >
        <span className="node-title">{step.title}</span>
        {modeChip(step.mode) ? <span className="mode-chip">{modeChip(step.mode)}</span> : null}
      </button>
      {active && live ? (
        <motion.span layoutId="live-badge" className={live.status === 'running' ? 'badge' : 'badge wait'}>
          {live.status === 'waiting_approval'
            ? 'Ждёт подтверждения'
            : live.status === 'waiting_user'
              ? 'Ждёт ответа'
              : live.status === 'waiting_access'
                ? 'Ждёт доступа'
              : live.status === 'waiting_plan'
                ? 'Можно править план'
                : 'Выполняется'}
        </motion.span>
      ) : null}
      {children.length > 0 ? (
        <div className={children.length > 1 ? 'kids many' : 'kids'}>
          {children.map((child) => (
            <Branch
              key={child.id}
              step={child}
              byId={byId}
              trail={nextTrail}
              activeId={activeId}
              doneIds={doneIds}
              selectedId={selectedId}
              linking={linking}
              live={live}
              onPick={onPick}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function modeChip(mode: StepMode): string | null {
  if (mode === 'approval') return 'проверка'
  if (mode === 'question') return 'вопрос'
  if (mode === 'ask') return 'смотреть'
  if (mode === 'plan') return 'план'
  if (mode === 'build') return 'сборка'
  if (mode === 'review') return 'сверка'
  return null
}

function agentRank(kind: AgentKind): number {
  const index = TASK_ROLES.indexOf(kind)
  return index === -1 ? TASK_ROLES.length : index
}
