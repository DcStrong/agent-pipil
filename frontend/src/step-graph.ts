/** Дерево шагов на холсте. Пустые связи читаются как цепочка. */
import type { WorkflowStep } from './types'

export function resolvedNext(steps: WorkflowStep[]): Map<string, string[]> {
  const ids = new Set(steps.map((step) => step.id))
  const explicit = steps.some((step) => (step.nextIds ?? []).length > 0)
  const map = new Map<string, string[]>()
  if (!explicit) {
    steps.forEach((step, index) => {
      const follower = steps[index + 1]
      map.set(step.id, follower ? [follower.id] : [])
    })
    return map
  }
  for (const step of steps) {
    map.set(step.id, [...new Set((step.nextIds ?? []).filter((id) => ids.has(id) && id !== step.id))])
  }
  return map
}

export function orderSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const next = resolvedNext(steps)
  const incoming = new Map<string, number>()
  for (const step of steps) incoming.set(step.id, 0)
  for (const ids of next.values()) {
    for (const id of ids) incoming.set(id, (incoming.get(id) ?? 0) + 1)
  }
  const byId = new Map(steps.map((step) => [step.id, step]))
  const ordered: WorkflowStep[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const step = byId.get(id)
    if (!step) return
    ordered.push(step)
    for (const child of next.get(id) ?? []) walk(child)
  }
  for (const step of steps) {
    if ((incoming.get(step.id) ?? 0) === 0) walk(step.id)
  }
  for (const step of steps) {
    if (!seen.has(step.id)) ordered.push(step)
  }
  return ordered
}

export function hasCycle(steps: WorkflowStep[]): boolean {
  const next = resolvedNext(steps)
  const mark = new Map<string, 'in' | 'out'>()
  const visit = (id: string): boolean => {
    const state = mark.get(id)
    if (state === 'in') return true
    if (state === 'out') return false
    mark.set(id, 'in')
    for (const child of next.get(id) ?? []) {
      if (visit(child)) return true
    }
    mark.set(id, 'out')
    return false
  }
  return steps.some((step) => visit(step.id))
}

/** Делает связи явными, чтобы холст мог ветвиться, а не только сдвигать строку. */
export function materialize(steps: WorkflowStep[]): WorkflowStep[] {
  const copy = steps.map((step) => ({ ...step, nextIds: [...(step.nextIds ?? [])] }))
  if (copy.some((step) => step.nextIds.length > 0)) return copy
  return copy.map((step, index) => ({
    ...step,
    nextIds: copy[index + 1] ? [copy[index + 1].id] : [],
  }))
}

export function withHandoffs(steps: WorkflowStep[]): WorkflowStep[] {
  const next = resolvedNext(steps)
  return steps.map((step) => {
    if ((next.get(step.id) ?? []).length > 0 && !step.handoff.trim()) {
      return { ...step, handoff: 'Передай результат следующему шагу.' }
    }
    return step
  })
}
