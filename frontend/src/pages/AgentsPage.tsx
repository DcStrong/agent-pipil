/** Список агентов и форма нового типа. */
import { useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { agentOnline, harnessLabel, kindLabel } from '../format'
import { useLive } from '../live'
import { href } from '../route'
import type { AgentKind, Harness } from '../types'

export function AgentsPage() {
  const { agents, cursor, reload } = useLive()
  const connected = cursor?.connected ?? false
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AgentKind>('custom')
  const [harness, setHarness] = useState<Harness>('simulated')
  const [instructions, setInstructions] = useState('Опиши, что этот агент делает с задачей.')
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const agent = await api.createAgent({ name, kind, instructions, harness })
      await reload()
      window.location.hash = href({ name: 'agent', agentId: agent.id })
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Агенты</h1>
      <div className="agent-grid">
        {agents.map((agent) => {
          const on = agentOnline(agent, connected)
          return (
            <a key={agent.id} className="card agent-card" href={href({ name: 'agent', agentId: agent.id })}>
              <strong>{agent.name}</strong>
              <p>
                {kindLabel(agent.kind)} · {harnessLabel(agent.harness)}
              </p>
              <span className={on ? 'pill completed' : 'pill failed'}>{on ? 'В сети' : 'Не подключён'}</span>
            </a>
          )
        })}
      </div>
      <form className="card form-card" onSubmit={(event) => void create(event)}>
        <h2>Новый агент</h2>
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
          <span>Инструкции</span>
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        </label>
        {error ? <p className="error-line">{error}</p> : null}
        <button type="submit" className="primary">
          Добавить агента
        </button>
      </form>
    </div>
  )
}
