import { useEffect, useState } from 'react'

export type Route =
  | { name: 'workflows' }
  | { name: 'canvas'; workflowId: string }
  | { name: 'board' }
  | { name: 'task'; taskId: string }
  | { name: 'plan'; taskId: string }
  | { name: 'runs' }
  | { name: 'run'; runId: string }
  | { name: 'agents' }
  | { name: 'agent'; agentId: string }
  | { name: 'project' }
  | { name: 'settings' }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const [head, id] = path.split('/')
  if (head === 'workflow' && id) return { name: 'canvas', workflowId: decodeURIComponent(id) }
  if (head === 'board') return { name: 'board' }
  if (head === 'task' && id) return { name: 'task', taskId: decodeURIComponent(id) }
  if (head === 'plan' && id) return { name: 'plan', taskId: decodeURIComponent(id) }
  if (head === 'run' && id) return { name: 'run', runId: decodeURIComponent(id) }
  if (head === 'agent' && id) return { name: 'agent', agentId: decodeURIComponent(id) }
  if (head === 'runs') return { name: 'runs' }
  if (head === 'agents') return { name: 'agents' }
  if (head === 'project') return { name: 'project' }
  if (head === 'settings') return { name: 'settings' }
  return { name: 'workflows' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function href(route: Route): string {
  if (route.name === 'canvas') return `#/workflow/${route.workflowId}`
  if (route.name === 'board') return '#/board'
  if (route.name === 'task') return `#/task/${route.taskId}`
  if (route.name === 'plan') return `#/plan/${route.taskId}`
  if (route.name === 'run') return `#/run/${route.runId}`
  if (route.name === 'agent') return `#/agent/${route.agentId}`
  if (route.name === 'runs') return '#/runs'
  if (route.name === 'agents') return '#/agents'
  if (route.name === 'project') return '#/project'
  if (route.name === 'settings') return '#/settings'
  return '#/workflows'
}
