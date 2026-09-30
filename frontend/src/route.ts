import { useEffect, useState } from 'react'

export type Route =
  | { name: 'workflows' }
  | { name: 'canvas'; workflowId: string }
  | { name: 'runs' }
  | { name: 'run'; runId: string }
  | { name: 'agents' }
  | { name: 'agent'; agentId: string }
  | { name: 'settings' }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const [head, id] = path.split('/')
  if (head === 'workflow' && id) return { name: 'canvas', workflowId: decodeURIComponent(id) }
  if (head === 'run' && id) return { name: 'run', runId: decodeURIComponent(id) }
  if (head === 'agent' && id) return { name: 'agent', agentId: decodeURIComponent(id) }
  if (head === 'runs') return { name: 'runs' }
  if (head === 'agents') return { name: 'agents' }
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
  if (route.name === 'run') return `#/run/${route.runId}`
  if (route.name === 'agent') return `#/agent/${route.agentId}`
  if (route.name === 'runs') return '#/runs'
  if (route.name === 'agents') return '#/agents'
  if (route.name === 'settings') return '#/settings'
  return '#/workflows'
}
