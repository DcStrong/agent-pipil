import { useEffect, useState } from 'react'
import { api } from './api'
import { Shell } from './components/Shell'
import { BoardPage } from './pages/BoardPage'
import { PipelinePage } from './pages/PipelinePage'
import { RolesPage } from './pages/RolesPage'
import { SkillsPage } from './pages/SkillsPage'
import { useView } from './route'
import type { AgentMode } from './types'

const titles = {
  board: 'Board',
  roles: 'Roles',
  skills: 'Skills',
  pipeline: 'Pipeline',
} as const

export default function App() {
  const view = useView()
  const [agentMode, setAgentMode] = useState<AgentMode | 'offline' | 'loading'>('loading')

  useEffect(() => {
    document.title = `Pipil · ${titles[view]}`
  }, [view])

  useEffect(() => {
    let cancel = false
    void api
      .health()
      .then((health) => {
        if (!cancel) setAgentMode(health.agentMode)
      })
      .catch(() => {
        if (!cancel) setAgentMode('offline')
      })
    return () => {
      cancel = true
    }
  }, [])

  return (
    <Shell view={view} agentMode={agentMode}>
      {view === 'roles' ? <RolesPage /> : null}
      {view === 'skills' ? <SkillsPage /> : null}
      {view === 'pipeline' ? <PipelinePage /> : null}
      {view === 'board' ? <BoardPage /> : null}
    </Shell>
  )
}
