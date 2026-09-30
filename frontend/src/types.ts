export type AgentKind = 'planner' | 'builder' | 'reviewer' | 'custom'
export type Harness = 'simulated' | 'cursor'
export type StepMode = 'automatic' | 'approval'
export type SkillScope = 'shared' | 'agent'
export type RunStatus = 'running' | 'waiting_approval' | 'completed' | 'failed'

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

export interface WorkflowStep {
  id: string
  agentId: string
  title: string
  mode: StepMode
  handoff: string
}

export interface Workflow {
  id: string
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
  kind: 'progress' | 'handoff' | 'approval' | 'error' | 'done'
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
}

export interface CursorConnection {
  connected: boolean
  source: 'none' | 'saved' | 'env'
  hint: string | null
}

export interface Health {
  ok: true
  cursorConnected: boolean
}

export type StreamMessage = { type: 'run'; run: Run } | { type: 'idle' }
