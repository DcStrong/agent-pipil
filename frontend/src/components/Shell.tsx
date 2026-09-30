import type { ReactNode } from 'react'
import type { AgentMode } from '../types'
import type { View } from '../route'

const links: Array<{ view: View; href: string; label: string }> = [
  { view: 'board', href: '#/board', label: 'Board' },
  { view: 'roles', href: '#/roles', label: 'Roles' },
  { view: 'skills', href: '#/skills', label: 'Skills' },
  { view: 'pipeline', href: '#/pipeline', label: 'Pipeline' },
]

const titles: Record<View, string> = {
  board: 'Board',
  roles: 'Roles',
  skills: 'Skills',
  pipeline: 'Pipeline',
}

export function Shell({
  view,
  agentMode,
  children,
}: {
  view: View
  agentMode: AgentMode | 'offline' | 'loading'
  children: ReactNode
}) {
  const modeLabel =
    agentMode === 'model'
      ? 'Model agents'
      : agentMode === 'offline'
        ? 'API offline'
        : agentMode === 'loading'
          ? 'Connecting'
          : 'Simulated agents'

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#/board">
          <span>pipil</span>
          <small>Local pipeline</small>
        </a>
        <nav className="nav" aria-label="Sections">
          {links.map((link) => (
            <a
              key={link.view}
              href={link.href}
              aria-current={view === link.view ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <p className={`mode mode-${agentMode}`}>{modeLabel}</p>
      </header>
      <div className="frame">{children}</div>
      <span className="sr-only">{titles[view]}</span>
    </div>
  )
}
