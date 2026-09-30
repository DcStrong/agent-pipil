/** Окно создания процесса: статусы агентов, затем публикация на сервере. */
import { useEffect, useRef, useState } from 'react'
import { api, messageOf } from '../api'
import { href } from '../route'
import { IconClose } from './Icons'

type Phase = 'done' | 'active' | 'wait'

const frames: Array<{ planner: Phase; builder: Phase; reviewer: Phase; flow: Phase; count: string; width: string }> = [
  { planner: 'done', builder: 'active', reviewer: 'wait', flow: 'wait', count: '1/4', width: '25%' },
  { planner: 'done', builder: 'done', reviewer: 'active', flow: 'wait', count: '2/4', width: '50%' },
  { planner: 'done', builder: 'done', reviewer: 'done', flow: 'active', count: '3/4', width: '75%' },
  { planner: 'done', builder: 'done', reviewer: 'done', flow: 'done', count: '4/4', width: '100%' },
]

function caption(phase: Phase, creating: string, created: string): string {
  if (phase === 'done') return created
  if (phase === 'active') return creating
  return 'Ожидание'
}

export function SetupModal({
  initialName,
  onClose,
}: {
  initialName: string
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef(initialName)
  const closeRef = useRef(onClose)

  useEffect(() => {
    nameRef.current = name
  }, [name])

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    let cancel = false
    let step = 0
    const timer = window.setInterval(() => {
      step += 1
      if (cancel) return
      if (step < frames.length) {
        setFrame(step)
        return
      }
      window.clearInterval(timer)
      void api
        .createWorkflow(nameRef.current.trim() || 'Новый процесс')
        .then((workflow) => {
          if (cancel) return
          window.location.hash = href({ name: 'canvas', workflowId: workflow.id })
          closeRef.current()
        })
        .catch((reason: unknown) => {
          if (!cancel) setError(messageOf(reason))
        })
    }, 700)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [])

  const current = frames[frame] ?? frames[0]

  return (
    <div className="modal-back" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="modal-head">
          <div>
            <h2 id="setup-title">Настройка процессов</h2>
            <p>Создаём нужных агентов, затем публикуем выбранный процесс.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </header>
        <label className="field">
          <span>Имя процесса</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        </label>
        <section className="setup-card">
          <div className="setup-top">
            <strong>Создание процессов</strong>
            <span>{current.count}</span>
          </div>
          <div className="bar" aria-hidden="true">
            <span style={{ width: current.width }} />
          </div>
          <div className="modal-grid">
            <div>
              <p className="kicker">Агенты</p>
              <AgentLine phase={current.planner} name="Планировщик" creating="Создаём планировщика…" created="Планировщик создан" />
              <AgentLine phase={current.builder} name="Сборщик" creating="Создаём сборщика…" created="Сборщик создан" />
              <AgentLine phase={current.reviewer} name="Ревьюер" creating="Создаём ревьюера…" created="Ревьюер создан" last />
            </div>
            <div>
              <p className="kicker">Процессы</p>
              <AgentLine
                phase={current.flow}
                name={name.trim() || 'Новый процесс'}
                creating="Публикуем процесс…"
                created="Процесс опубликован"
                last
              />
            </div>
          </div>
        </section>
        {error ? <p className="error-line">{error}</p> : null}
        <footer className="modal-foot">
          <button type="button" className="text-btn" onClick={onClose}>
            Назад
          </button>
        </footer>
      </div>
    </div>
  )
}

function AgentLine({
  phase,
  name,
  creating,
  created,
  last = false,
}: {
  phase: Phase
  name: string
  creating: string
  created: string
  last?: boolean
}) {
  return (
    <div className="setup-agent">
      <div className="mark-col">
        <span className={`mark ${phase}`} aria-hidden="true" />
        {last ? null : <span className="stem" />}
      </div>
      <div>
        <strong>{name}</strong>
        <p>{caption(phase, creating, created)}</p>
      </div>
    </div>
  )
}
