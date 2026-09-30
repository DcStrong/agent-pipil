/** Карточка агента: статус, среда, навыки и инструкции. */
import { useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { IconAgent, IconPlus } from '../components/Icons'
import { agentOnline, harnessLabel } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import type { AgentKind, Harness, SkillScope } from '../types'

export function AgentPage({ agentId }: { agentId: string }) {
  const { ready, agents, skills, cursor, reload } = useLive()
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
          <label className="field">
            <span>Область</span>
            <select value={scope} onChange={(event) => setScope(event.target.value as SkillScope)}>
              <option value="agent">Только этот агент</option>
              <option value="shared">Общий</option>
            </select>
          </label>
          <button type="submit" className="primary">
            <IconPlus /> Добавить
          </button>
        </form>
      </section>
      <form className="card form-card" onSubmit={(event) => void save(event)}>
        <h2>Инструкции</h2>
        <p className="hint" data-testid="role-duty-hint">
          Зону ответственности можно поправить в этом поле или оставить текущий текст. Более полный вариант по
          умолчанию появится позже.
        </p>
        <label className="field">
          <span>Имя</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="split">
          <label className="field">
            <span>Тип</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as AgentKind)}>
              <option value="orchestrator">Оркестратор</option>
              <option value="analyst">Аналитик</option>
              <option value="architect">Архитектор</option>
              <option value="developer">Бэкенд-разработчик</option>
              <option value="tester">Тестировщик</option>
              <option value="custom">Свой</option>
            </select>
          </label>
          <label className="field">
            <span>Среда</span>
            <select value={harness} onChange={(event) => setHarness(event.target.value as Harness)}>
              <option value="simulated">Имитация</option>
              <option value="cursor">Cursor</option>
            </select>
          </label>
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
