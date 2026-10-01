/** Три коротких примера рядом с ролями. Кнопка только настраивает цепочку, запуск — с доски. */
import type { Agent, AgentKind } from '../types'

export type ExampleId = 'feature' | 'refactor' | 'plan'

interface Example {
  id: ExampleId
  title: string
  text: string
  /** Пустой список значит «флажки ролей не трогать». */
  enable: AgentKind[]
  disable: AgentKind[]
  applyLabel: string
}

const EXAMPLES: Example[] = [
  {
    id: 'feature',
    title: 'Новая возможность',
    text: 'Оркестратор, разработчик и тестировщик — типичная цепочка для новой возможности. Задачу создайте на доске и перенесите в работу.',
    task: '',
    enable: ['orchestrator', 'developer', 'tester'],
    disable: ['analyst', 'architect'],
    applyLabel: 'Подставить роли',
  },
  {
    id: 'refactor',
    title: 'Рефакторинг',
    text: 'Аналитика и архитектора не включайте. Оставьте разработчика. Если нужна проверка — тестировщика или ревьюера; в списке ролей проверка — это тестировщик.',
    enable: ['developer', 'tester'],
    disable: ['analyst', 'architect'],
    applyLabel: 'Подставить',
  },
  {
    id: 'plan',
    title: 'План без кода',
    text: 'Включите оркестратора, аналитика и архитектора. Итог будет планом, не кодом. Разработчика и тестировщика оставьте выключенными.',
    enable: ['orchestrator', 'analyst', 'architect'],
    disable: ['developer', 'tester'],
    applyLabel: 'Подставить',
  },
]

/** Собирает отмеченные роли по примеру. Роли вне списков enable и disable не меняются. */
function pickedForExample(exampleId: ExampleId, agents: Agent[], picked: string[]): string[] {
  const example = EXAMPLES.find((item) => item.id === exampleId)
  if (!example) return picked
  const next = new Set(picked)
  for (const kind of example.disable) {
    for (const agent of agents) {
      if (agent.kind === kind) next.delete(agent.id)
    }
  }
  for (const kind of example.enable) {
    const agent = agents.find((item) => item.kind === kind)
    if (agent) next.add(agent.id)
  }
  return [...next]
}

export function TaskExamples({
  agents,
  picked,
  active,
  onApply,
}: {
  agents: Agent[]
  picked: string[]
  active: ExampleId | null
  onApply: (exampleId: ExampleId, picked: string[]) => void
}) {
  return (
    <div className="examples" data-testid="task-examples">
      <span className="kicker">Короткие примеры</span>
      {EXAMPLES.map((example) => (
        <article key={example.id} data-testid={`example-${example.id}`}>
          <strong>{example.title}</strong>
          <p>{example.text}</p>
          <button
            type="button"
            aria-pressed={active === example.id}
            data-testid={`apply-${example.id}`}
            onClick={() => onApply(example.id, pickedForExample(example.id, agents, picked))}
          >
            {example.applyLabel}
          </button>
        </article>
      ))}
    </div>
  )
}
