/** Оболочка: тёмная рейка и экраны процессов, холста, запусков, агентов и проекта. */
import { useEffect } from 'react'
import { Rail } from './components/Rail'
import { LiveProvider } from './live'
import { AgentPage } from './pages/AgentPage'
import { AgentsPage } from './pages/AgentsPage'
import { BoardPage } from './pages/BoardPage'
import { CanvasPage } from './pages/CanvasPage'
import { PlanPage } from './pages/PlanPage'
import { RunPage } from './pages/RunPage'
import { ProjectPage } from './pages/ProjectPage'
import { RunsPage } from './pages/RunsPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkflowsPage } from './pages/WorkflowsPage'
import { useRoute, type Route } from './route'

const titles: Record<Route['name'], string> = {
  workflows: 'Процессы',
  canvas: 'Холст',
  board: 'Доска',
  plan: 'План',
  runs: 'Запуски',
  run: 'Запуск',
  agents: 'Агенты',
  agent: 'Агент',
  project: 'Проект',
  settings: 'Настройки',
}

export default function App() {
  return (
    <LiveProvider>
      <Shell />
    </LiveProvider>
  )
}

function Shell() {
  const route = useRoute()
  const flush = route.name === 'canvas' || route.name === 'run' || route.name === 'board'

  useEffect(() => {
    document.title = `Пипил · ${titles[route.name]}`
  }, [route])

  return (
    <div className="app">
      <Rail route={route} />
      <main className={flush ? 'workspace flush' : 'workspace'}>
        {route.name === 'workflows' ? <WorkflowsPage /> : null}
        {route.name === 'canvas' ? <CanvasPage workflowId={route.workflowId} /> : null}
        {route.name === 'board' ? <BoardPage /> : null}
        {route.name === 'plan' ? <PlanPage taskId={route.taskId} /> : null}
        {route.name === 'runs' ? <RunsPage /> : null}
        {route.name === 'run' ? <RunPage runId={route.runId} /> : null}
        {route.name === 'agents' ? <AgentsPage /> : null}
        {route.name === 'agent' ? <AgentPage agentId={route.agentId} /> : null}
        {route.name === 'project' ? <ProjectPage /> : null}
        {route.name === 'settings' ? <SettingsPage /> : null}
      </main>
    </div>
  )
}
