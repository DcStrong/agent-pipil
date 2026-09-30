/** Общее состояние экранов: агенты, процессы, запуски и поток событий. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, mergeRun, messageOf, subscribeRuns } from './api'
import type { Agent, CursorConnection, Run, Skill, Workflow } from './types'

interface LiveValue {
  ready: boolean
  error: string | null
  agents: Agent[]
  skills: Skill[]
  workflows: Workflow[]
  runs: Run[]
  cursor: CursorConnection | null
  reload: () => Promise<void>
  upsertRun: (run: Run) => void
  /** Кладёт процесс в уже открытый список, без повторной загрузки всей страницы. */
  upsertWorkflow: (workflow: Workflow) => void
}

const LiveContext = createContext<LiveValue | null>(null)

export function LiveProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [cursor, setCursor] = useState<CursorConnection | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [nextAgents, nextSkills, nextWorkflows, nextRuns, nextCursor] = await Promise.all([
      api.agents(),
      api.skills(),
      api.workflows(),
      api.runs(),
      api.cursor(),
    ])
    setAgents(nextAgents)
    setSkills(nextSkills)
    setWorkflows(nextWorkflows)
    setRuns(nextRuns)
    setCursor(nextCursor)
    setReady(true)
    setError(null)
  }, [])

  const upsertRun = useCallback((run: Run) => {
    setRuns((list) => mergeRun(list, run))
  }, [])

  const upsertWorkflow = useCallback((workflow: Workflow) => {
    setWorkflows((list) => {
      const index = list.findIndex((item) => item.id === workflow.id)
      if (index === -1) return [...list, workflow]
      const next = list.slice()
      next[index] = workflow
      return next
    })
  }, [])

  useEffect(() => {
    let cancel = false
    void reload().catch((reason: unknown) => {
      if (!cancel) setError(messageOf(reason))
    })
    const stop = subscribeRuns((message) => {
      if (message.type === 'run') upsertRun(message.run)
    })
    return () => {
      cancel = true
      stop()
    }
  }, [reload, upsertRun])

  const active = runs.some((run) => run.status === 'running' || run.status === 'waiting_approval')

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      void api
        .runs()
        .then((fresh) => {
          setRuns((current) => fresh.reduce((list, run) => mergeRun(list, run), current))
        })
        .catch(() => undefined)
    }, 400)
    return () => window.clearInterval(timer)
  }, [active])

  const value = useMemo<LiveValue>(
    () => ({ ready, error, agents, skills, workflows, runs, cursor, reload, upsertRun, upsertWorkflow }),
    [ready, error, agents, skills, workflows, runs, cursor, reload, upsertRun, upsertWorkflow],
  )

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext)
  if (!value) throw new Error('Экраны открыты вне поставщика данных.')
  return value
}
