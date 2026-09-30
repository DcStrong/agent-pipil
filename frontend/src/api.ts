import type {
  Agent,
  AgentKind,
  CursorConnection,
  Harness,
  Health,
  PipelinePreset,
  PresetSteps,
  Run,
  Skill,
  SkillScope,
  StepMode,
  StreamMessage,
  Workflow,
  WorkflowStep,
} from './types'

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Что-то пошло не так.'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    let message = 'Запрос не выполнен.'
    try {
      const body = (await response.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(' ')
      else if (typeof body.message === 'string' && body.message) message = body.message
    } catch {
      message = 'Запрос не выполнен.'
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  agents: () => request<Agent[]>('/api/agents'),
  agent: (id: string) => request<Agent>(`/api/agents/${id}`),
  createAgent: (body: { name: string; kind: AgentKind; instructions: string; harness: Harness }) =>
    request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: { name: string; kind: AgentKind; instructions: string; harness: Harness }) =>
    request<Agent>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAgent: (id: string) => request<{ ok: true }>(`/api/agents/${id}`, { method: 'DELETE' }),
  skills: () => request<Skill[]>('/api/skills'),
  createSkill: (body: { name: string; instructions: string; scope: SkillScope; agentId: string | null }) =>
    request<Skill>('/api/skills', { method: 'POST', body: JSON.stringify(body) }),
  deleteSkill: (id: string) => request<{ ok: true }>(`/api/skills/${id}`, { method: 'DELETE' }),
  workflows: () => request<Workflow[]>('/api/workflows'),
  workflow: (id: string) => request<Workflow>(`/api/workflows/${id}`),
  createWorkflow: (name: string) =>
    request<Workflow>('/api/workflows', { method: 'POST', body: JSON.stringify({ name }) }),
  saveWorkflow: (
    id: string,
    body: { name: string; description: string; steps: WorkflowStep[] },
  ) => request<Workflow>(`/api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  presets: () => request<PipelinePreset[]>('/api/presets'),
  createPreset: (body: {
    name: string
    description?: string
    steps: Array<{
      key: string
      agentId: string
      title: string
      mode: StepMode
      handoff: string
      nextKeys: string[]
    }>
  }) => request<PipelinePreset>('/api/presets', { method: 'POST', body: JSON.stringify(body) }),
  deletePreset: (id: string) => request<{ ok: true }>(`/api/presets/${id}`, { method: 'DELETE' }),
  presetSteps: (id: string) => request<PresetSteps>(`/api/presets/${id}/steps`),
  openPreset: (id: string) => request<Workflow>(`/api/presets/${id}/workflows`, { method: 'POST' }),
  runs: () => request<Run[]>('/api/runs'),
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  startRun: (
    workflowId: string,
    task: string,
    options?: { roleIds?: string[]; projectPath?: string; mapPath?: string },
  ) =>
    request<Run>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflowId,
        task,
        roleIds: options?.roleIds,
        projectPath: options?.projectPath ?? null,
        mapPath: options?.mapPath ?? null,
      }),
    }),
  answer: (id: string, text: string) =>
    request<Run>(`/api/runs/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  decide: (id: string, decision: 'approve' | 'reject') =>
    request<Run>(`/api/runs/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  cursor: () => request<CursorConnection>('/api/settings/cursor'),
  saveCursor: (token: string) =>
    request<CursorConnection>('/api/settings/cursor', {
      method: 'PUT',
      body: JSON.stringify({ token }),
    }),
  clearCursor: () => request<CursorConnection>('/api/settings/cursor', { method: 'DELETE' }),
}

export function subscribeRuns(onMessage: (message: StreamMessage) => void): () => void {
  const source = new EventSource('/api/runs/events')
  source.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data) as StreamMessage)
    } catch {
      // Служебный пакет без JSON пропускаем.
    }
  }
  return () => source.close()
}

export function mergeRun(list: Run[], run: Run): Run[] {
  const existing = list.find((item) => item.id === run.id)
  if (existing && existing.updatedAt > run.updatedAt) return list
  const rest = list.filter((item) => item.id !== run.id)
  return [run, ...rest].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
