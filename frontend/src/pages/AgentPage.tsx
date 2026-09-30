/** Карточка агента: статус, среда, навыки и инструкции. */
import { useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { DarkSelect } from '../components/DarkSelect'
import { IconAgent, IconPlus } from '../components/Icons'
import { agentOnline, harnessLabel } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import { materialize, orderSteps, withHandoffs } from '../step-graph'
import type { AgentKind, Harness, SkillScope, Workflow, WorkflowStep } from '../types'

export function AgentPage({ agentId }: { agentId: string }) {
  const { ready, agents, skills, workflows, cursor, reload } = useLive()
  const agent = agents.find((item) => item.id === agentId)
  const connected = cursor?.connected ?? false
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AgentKind>('custom')
  const [harness, setHarness] = useState<Harness>('simulated')
  const [instructions, setInstructions] = useState('')
  const [skillName, setSkillName] = useState('')
  const [skillText, setSkillText] = useState('')
  const [scope, setScope] = useState<SkillScope>('agent')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const signature = agent ? `${agent.id}:${agent.name}:${agent.kind}:${agent.harness}:${agent.instructions}` : ''

  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setKind(agent.kind)
    setHarness(agent.harness)
    setInstructions(agent.instructions)
  }, [signature])

  if (!ready) {
    return (
      <div className="page">
        <p className="muted">Загрузка…</p>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="page">
        <p className="muted">Агент не найден.</p>
        <a href={href({ name: 'agents' })}>К агентам</a>
      </div>
    )
  }

  const online = agentOnline({ ...agent, harness }, connected)
  const own = skills.filter((skill) => skill.scope === 'shared' || skill.agentId === agent.id)

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    try {
      await api.updateAgent(agentId, { name, kind, instructions, harness })
      await reload()
      setSaved(true)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function addSkill(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await api.createSkill({
        name: skillName,
        instructions: skillText,
        scope,
        agentId: scope === 'agent' ? agentId : null,
      })
      setSkillName('')
      setSkillText('')
      await reload()
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function removeSkill(id: string) {
    setError(null)
    try {
      await api.deleteSkill(id)
      await reload()
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function place(workflow: Workflow) {
    if (!agent) return
    setError(null)
    try {
      const steps = materialize(workflow.steps)
      const id = crypto.randomUUID()
      const created: WorkflowStep = {
        id,
        agentId: agent.id,
        title: agent.name,
        mode: agent.kind === 'architect' ? 'question' : agent.kind === 'reviewer' ? 'approval' : 'automatic',
        handoff: '',
        nextIds: [],
      }
      const tail = orderSteps(steps).at(-1)
      const next = tail
        ? withHandoffs([
            ...steps.map((step) => (step.id === tail.id ? { ...step, nextIds: [...step.nextIds, id] } : step)),
            created,
          ])
        : [created]
      await api.saveWorkflow(workflow.id, {
        name: workflow.name,
        description: workflow.description,
        steps: next,
      })
      await reload()
      window.location.hash = href({ name: 'canvas', workflowId: workflow.id })
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function removeAgent() {
    setError(null)
    try {
      await api.deleteAgent(agentId)
      await reload()
      window.location.hash = href({ name: 'agents' })
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page agent-page">
      <p className="crumb">
        <a href={href({ name: 'agents' })}>Агенты</a>
        <span>/</span>
        <span>{agent.name}</span>
      </p>
      <header className="agent-hero">
        <span className="hero-mark">
          <IconAgent />
        </span>
        <h1>{name || agent.name}</h1>
      </header>
      <section className="card info-card">
        <div className="info-grid">
          <div>
            <p className="kicker">Статус</p>
            <span className={online ? 'pill completed' : 'pill failed'} data-testid="agent-status">
              {online ? 'В сети' : 'Не подключён'}
            </span>
          </div>
          <div>
            <p className="kicker">Последний раз</p>
            <strong>{online ? 'только что' : 'нет сеанса'}</strong>
          </div>
          <div>
            <p className="kicker">Владелец</p>
            <strong>Локальный владелец</strong>
          </div>
          <div>
            <p className="kicker">Среда агента</p>
            <strong>{harnessLabel(harness)}</strong>
          </div>
          <div>
            <p className="kicker">Изоляция</p>
            <strong>Один запуск за раз</strong>
          </div>
          <div>
            <p className="kicker">Процесс</p>
            <strong>{harness === 'cursor' ? 'Токен только на сервере' : 'Локальная имитация'}</strong>
          </div>
        </div>
        <div className="machine">
          <p className="kicker">Машина</p>
          <div className="machine-row">
            <span>Локальная</span>
            <span className={online ? 'live' : 'dim'}>{online ? 'Работает' : 'Не подключён'}</span>
            <span>{online ? 'только что' : '—'}</span>
          </div>
        </div>
      </section>
      <section className="card">
        <header className="card-head">
          <span>Возможности</span>
        </header>
        <p className="hint">Навыки, которые этот агент применяет к задаче. Общие навыки видят все.</p>
        {own.length === 0 ? <p className="empty">Навыков пока нет.</p> : null}
        <ul className="cap-list">
          {own.map((skill) => (
            <li key={skill.id}>
              <div>
                <strong>{skill.name}</strong>
                <p>{skill.instructions}</p>
                <small>{skill.scope === 'shared' ? 'Общий' : 'Этот агент'}</small>
              </div>
              <button type="button" onClick={() => void removeSkill(skill.id)}>
                Удалить
              </button>
            </li>
          ))}
        </ul>
        <form className="skill-form" onSubmit={(event) => void addSkill(event)}>
          <label className="field">
            <span>Навык</span>
            <input value={skillName} onChange={(event) => setSkillName(event.target.value)} />
          </label>
          <label className="field">
            <span>Инструкции навыка</span>
            <textarea value={skillText} onChange={(event) => setSkillText(event.target.value)} />
          </label>
          <div className="field">
            <span>Область</span>
            <DarkSelect
              testId="skill-scope"
              value={scope}
              options={[
                { value: 'agent', label: 'Только этот агент' },
                { value: 'shared', label: 'Общий' },
              ]}
              onChange={(value) => setScope(value as SkillScope)}
            />
          </div>
          <button type="submit" className="primary">
            <IconPlus /> Добавить
          </button>
        </form>
      </section>
      <section className="card">
        <header className="card-head">
          <span>На холсте</span>
        </header>
        <p className="hint">Поставьте агента следом за последним шагом процесса. На холсте его можно связать с соседями или ответвить.</p>
        {workflows.length === 0 ? <p className="empty">Сначала создайте процесс.</p> : null}
        <ul className="cap-list">
          {workflows.map((workflow) => (
            <li key={workflow.id}>
              <div>
                <strong>{workflow.name}</strong>
                <p>{workflow.steps.length} шагов</p>
              </div>
              <button type="button" data-testid={`place-${workflow.id}`} onClick={() => void place(workflow)}>
                Поставить следом
              </button>
            </li>
          ))}
        </ul>
      </section>
      <form className="card form-card" onSubmit={(event) => void save(event)}>
        <h2>Инструкции</h2>
        <p className="hint">Дополнительное указание, как агент ведёт свой шаг.</p>
        <label className="field">
          <span>Имя</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="split">
          <div className="field">
            <span>Тип</span>
            <DarkSelect
              value={kind}
              options={[
                { value: 'orchestrator', label: 'Оркестратор' },
                { value: 'analyst', label: 'Аналитик' },
                { value: 'architect', label: 'Архитектор' },
                { value: 'developer', label: 'Бэкенд-разработчик' },
                { value: 'tester', label: 'Тестировщик' },
                { value: 'custom', label: 'Свой' },
              ]}
              onChange={(value) => setKind(value as AgentKind)}
            />
          </div>
          <div className="field">
            <span>Среда</span>
            <DarkSelect
              value={harness}
              options={[
                { value: 'simulated', label: 'Имитация' },
                { value: 'cursor', label: 'Cursor' },
              ]}
              onChange={(value) => setHarness(value as Harness)}
            />
          </div>
        </div>
        <label className="field">
          <span>Текст</span>
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        </label>
        {saved ? <p className="ok-line">Сохранено.</p> : null}
        {error ? <p className="error-line">{error}</p> : null}
        <div className="row-actions">
          <button type="submit" className="primary">
            Сохранить агента
          </button>
          <button type="button" onClick={() => void removeAgent()}>
            Удалить
          </button>
        </div>
      </form>
    </div>
  )
}
