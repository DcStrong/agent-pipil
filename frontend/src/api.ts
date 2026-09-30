import type {
  Health,
  PipelineStage,
  Role,
  Run,
  Skill,
  StreamMessage,
} from './types'

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong.'
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
    let message = response.statusText
    try {
      const body = (await response.json()) as { message?: string | string[] }
      if (Array.isArray(body.message)) message = body.message.join(' ')
      else if (typeof body.message === 'string' && body.message) message = body.message
    } catch {
      message = response.statusText
    }
    throw new Error(message || 'Request failed.')
  }
  return (await response.json()) as T
}

export const api = {
  health: () => request<Health>('/api/health'),
  roles: () => request<Role[]>('/api/roles'),
  createRole: (body: { name: string; systemPrompt: string }) =>
    request<Role>('/api/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateRole: (id: string, body: { name: string; systemPrompt: string }) =>
    request<Role>(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteRole: (id: string) =>
    request<{ ok: true }>(`/api/roles/${id}`, { method: 'DELETE' }),
  skills: () => request<Skill[]>('/api/skills'),
  createSkill: (body: {
    name: string
    instructions: string
    scope: 'shared' | 'role'
    roleId: string | null
  }) => request<Skill>('/api/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (
    id: string,
    body: {
      name: string
      instructions: string
      scope: 'shared' | 'role'
      roleId: string | null
    },
  ) => request<Skill>(`/api/skills/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSkill: (id: string) =>
    request<{ ok: true }>(`/api/skills/${id}`, { method: 'DELETE' }),
  pipeline: () => request<PipelineStage[]>('/api/pipeline'),
  savePipeline: (stages: PipelineStage[]) =>
    request<PipelineStage[]>('/api/pipeline', {
      method: 'PUT',
      body: JSON.stringify({ stages }),
    }),
  runs: () => request<Run[]>('/api/runs'),
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  startRun: (task: string) =>
    request<Run>('/api/runs', { method: 'POST', body: JSON.stringify({ task }) }),
}

export function subscribeRuns(onMessage: (message: StreamMessage) => void): () => void {
  const source = new EventSource('/api/runs/events')
  source.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data) as StreamMessage)
    } catch {
      // Ignore a malformed event.
    }
  }
  return () => source.close()
}
