/** Узкая тёмная рейка: только экраны, которые реально открываются. */
import { IconAgent, IconBoard, IconGear, IconNodes, IconRuns } from './Icons'
import { href, type Route } from '../route'

export function Rail({ route }: { route: Route }) {
  const items: Array<{ route: Route; label: string; icon: 'nodes' | 'board' | 'runs' | 'agent'; on: boolean }> = [
    {
      route: { name: 'workflows' },
      label: 'Процессы',
      icon: 'nodes',
      on: route.name === 'workflows' || route.name === 'canvas',
    },
    {
      route: { name: 'board' },
      label: 'Доска',
      icon: 'board',
      on: route.name === 'board' || route.name === 'plan',
    },
    {
      route: { name: 'runs' },
      label: 'Запуски',
      icon: 'runs',
      on: route.name === 'runs' || route.name === 'run',
    },
    {
      route: { name: 'agents' },
      label: 'Агенты',
      icon: 'agent',
      on: route.name === 'agents' || route.name === 'agent',
    },
  ]

  return (
    <nav className="rail" aria-label="Разделы">
      {items.map((item) => (
        <a
          key={item.label}
          className={item.on ? 'rail-link on' : 'rail-link'}
          href={href(item.route)}
          aria-label={item.label}
          title={item.label}
          aria-current={item.on ? 'page' : undefined}
        >
          {item.icon === 'nodes' ? <IconNodes /> : null}
          {item.icon === 'board' ? <IconBoard /> : null}
          {item.icon === 'runs' ? <IconRuns /> : null}
          {item.icon === 'agent' ? <IconAgent /> : null}
        </a>
      ))}
      <div className="rail-spacer" />
      <a
        className={route.name === 'settings' ? 'rail-link on' : 'rail-link'}
        href={href({ name: 'settings' })}
        aria-label="Настройки"
        title="Настройки"
        aria-current={route.name === 'settings' ? 'page' : undefined}
      >
        <IconGear />
      </a>
    </nav>
  )
}
