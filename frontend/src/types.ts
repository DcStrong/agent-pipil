export type AgentKind =
  | 'orchestrator'
  | 'analyst'
  | 'architect'
  | 'developer'
  | 'tester'
  | 'planner'
  | 'builder'
  | 'reviewer'
  | 'custom'
export type Harness = 'simulated' | 'cursor'
export type StepMode = 'automatic' | 'approval' | 'question' | 'ask' | 'plan' | 'build' | 'review'
export type SkillScope = 'shared' | 'agent'
export type RunStatus =
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'waiting_plan'
  | 'completed'
  | 'failed'
export type ReturnShape = 'object' | 'array' | 'none'
export type DialogueAuthor = 'role' | 'user' | 'handoff'

export interface Agent {
  id: string
  name: string
  kind: AgentKind
  instructions: string
  harness: Harness
}

export interface Skill {
  id: string
  name: string
  instructions: string
  scope: SkillScope
  agentId: string | null
}

export interface HandoffBrief {
  goal: string
  decided: string
  now: string
}

export interface TaskPlan {
  why: string
  changes: string
  how: string
  checklist: string
}

export interface TaskArchive {
  note: string
  plan: TaskPlan
  result: string
  at: string
  folder: string | null
}

export interface DialogueMessage {
  id: string
  at: string
  author: DialogueAuthor
  text: string
}

export interface ProjectSnapshot {
  folder: string | null
  available: boolean
  rules: string[]
  skills: string[]
  commands: string[]
  mapPath: string | null
  mapText: string | null
  mapMissing: boolean
  pointedAtMap: boolean
  surveyed: boolean
  survey: string[]
  tests: string[]
}

export interface WorkflowStep {
  id: string
  agentId: string
  title: string
  mode: StepMode
  handoff: string
  nextIds: string[]
}

export interface Workflow {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
}

/** Шаг сохранённой цепочки. У встроенных agentId пустой, роль выбирается по kind. */
export interface PresetStep {
  key: string
  agentId: string | null
  kind: AgentKind
  title: string
  mode: StepMode
  handoff: string
  nextKeys: string[]
}

export interface PipelinePreset {
  id: string
  name: string
  description: string
  builtin: boolean
  steps: PresetStep[]
}

/** Готовые шаги пресета с новыми id, чтобы поставить их на холст. */
export interface PresetSteps {
  name: string
  description: string
  steps: WorkflowStep[]
}

export interface StepWork {
  stepId: string
  agentId: string
  agentName: string
  title: string
  output: string
  summary: string
  startedAt: string
  finishedAt: string
}

export interface RunEvent {
  id: string
  at: string
  kind: 'progress' | 'handoff' | 'approval' | 'question' | 'error' | 'done'
  message: string
  stepIndex: number | null
}

export interface RunStep {
  stepId: string
  agentId: string
  agentName: string
  title: string
  mode: StepMode
  handoff: string
  instructions: string
  harness: Harness
  skills: Array<{ name: string; instructions: string; scope: SkillScope }>
  dialogueId: string
  kind: AgentKind
  messages: DialogueMessage[]
  brief: HandoffBrief | null
  question: string | null
  mapAddition: string | null
}

export interface Run {
  id: string
  workflowId: string
  workflowName: string
  task: string
  status: RunStatus
  stepIndex: number | null
  steps: RunStep[]
  work: StepWork[]
  events: RunEvent[]
  finalResult: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
  project: ProjectSnapshot | null
  developerShape: ReturnShape
  pendingQuestion: string | null
  mapWritten: boolean
  mapNote: string | null
  deepThinking: boolean
  note: string | null
  plan: TaskPlan | null
  buildText: string | null
  reviewText: string | null
  taskFolder: string | null
  archive: TaskArchive | null
}

export type CursorFileKind = 'rule' | 'skill' | 'mcp'

export interface CursorFileItem {
  kind: CursorFileKind
  name: string
  relativePath: string
}

export interface CursorFileDocument extends CursorFileItem {
  content: string
}

/** Предложение выключено, пока пользователь сам не запишет файл. */
export interface CursorRecommendation {
  id: 'machine-runs'
  title: string
  text: string
  relativePath: string
  added: boolean
}

export interface CursorProjectView {
  folder: string | null
  available: boolean
  cursorApi: 'disconnected'
  rules: CursorFileItem[]
  skills: CursorFileItem[]
  mcp: CursorFileItem[]
  recommendation: CursorRecommendation
}

export type CursorConnectionMode = 'cli' | 'api'

export interface CursorConnection {
  connected: boolean
  source: 'none' | 'saved' | 'env'
  hint: string | null
  mode: CursorConnectionMode
}

export type SavedProjectKind = 'folder' | 'workspace'

export interface SavedProject {
  id: string
  kind: SavedProjectKind
  path: string
  folderName: string
  alias: string
  label: string
}

export interface Health {
  ok: true
  cursorConnected: boolean
}

export type StreamMessage = { type: 'run'; run: Run } | { type: 'idle' }

export type BoardStatus = 'new' | 'in_progress' | 'review'
export type WorkMode = 'ask' | 'plan' | 'agent'
export type BoardPhase = 'idle' | 'working' | 'plan' | 'build' | 'done'
export type MemberState = 'working' | 'waiting' | 'done'

export interface TeamMember {
  agentId: string
  mode: WorkMode
}

export interface BoardActivity {
  agentId: string
  agentName: string
  mode: WorkMode
  state: MemberState
  note: string
}

export interface BoardPlan {
  text: string
  authorAgentId: string
  authorName: string
  editable: boolean
  updatedAt: string
}

export interface BoardTask {
  id: string
  title: string
  description: string
  status: BoardStatus
  projectId: string
  projectLabel: string
  workflowId: string | null
  workflowName: string | null
  runId: string | null
  team: TeamMember[]
  phase: BoardPhase
  activity: BoardActivity[]
  plan: BoardPlan | null
  createdAt: string
  updatedAt: string
}
