/** Черновики процессов живут в sessionStorage, пока пользователь не нажмёт «Сохранить». */
import type { Workflow } from './types'

const DRAFTS_KEY = 'pipil:workflow-drafts'
const PRESET_DRAFT_KEY = 'pipil:preset-draft-ids'

function readDrafts(): Record<string, Workflow> {
  try {
    const raw = sessionStorage.getItem(DRAFTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Workflow>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDrafts(drafts: Record<string, Workflow>) {
  sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

function readPresetMap(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(PRESET_DRAFT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePresetMap(map: Record<string, string>) {
  sessionStorage.setItem(PRESET_DRAFT_KEY, JSON.stringify(map))
}

export function isWorkflowDraft(id: string): boolean {
  return Boolean(readDrafts()[id])
}

export function loadWorkflowDraft(id: string): Workflow | null {
  return readDrafts()[id] ?? null
}

export function saveWorkflowDraft(workflow: Workflow): void {
  const drafts = readDrafts()
  drafts[workflow.id] = workflow
  writeDrafts(drafts)
}

export function removeWorkflowDraft(id: string): void {
  const drafts = readDrafts()
  if (!drafts[id]) return
  delete drafts[id]
  writeDrafts(drafts)
  const map = readPresetMap()
  for (const [presetId, workflowId] of Object.entries(map)) {
    if (workflowId === id) {
      delete map[presetId]
      writePresetMap(map)
      break
    }
  }
}

/** Один черновик на пресет: повторный клик открывает тот же id, не плодя записи. */
export function presetDraftWorkflowId(presetId: string): string | null {
  return readPresetMap()[presetId] ?? null
}

export function bindPresetDraft(presetId: string, workflowId: string): void {
  const map = readPresetMap()
  map[presetId] = workflowId
  writePresetMap(map)
}
