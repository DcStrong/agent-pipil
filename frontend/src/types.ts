export type AgentMode = 'simulated' | 'model'

export interface Role {
  id: string
  name: string
  systemPrompt: string
}

export interface Skill {
  id: string
  name: string
  instructions: string
  scope: 'shared' | 'role'
  roleId: string | null
}

export interface PipelineStage {
  id: string
  roleId: string
  handoffInstruction: string
}

export interface StageWork {
  stageId: string
  roleId: string
  roleName: string
  output: string
  summary: string
  startedAt: string
  finishedAt: string
}

export interface RunEvent {
  id: string
  at: string
  kind: 'started' | 'stage_started' | 'handoff' | 'completed' | 'failed'
  message: string
  stageIndex: number | null
  roleId: string | null
}

export interface RunStage {
  stageId: string
  roleId: string
  roleName: string
  systemPrompt: string
  handoffInstruction: string
  skills: Array<{
    name: string
    instructions: string
    scope: 'shared' | 'role'
  }>
}

export interface Run {
  id: string
  task: string
  status: 'running' | 'completed' | 'failed'
  stageIndex: number | null
  ownerRoleId: string | null
  ownerName: string | null
  stages: RunStage[]
  work: StageWork[]
  events: RunEvent[]
  finalResult: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type StreamMessage = { type: 'run'; run: Run } | { type: 'idle' }

export interface Health {
  ok: true
  agentMode: AgentMode
}
