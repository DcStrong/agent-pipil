import type {
  Agent,
  AgentKind,
  BoardStatus,
  BoardTask,
  CursorConnection,
  CursorConnectionMode,
  SavedProject,
  SavedProjectKind,
  CursorFileDocument,
  CursorFileKind,
  CursorProjectView,
  CursorRecommendation,
  Harness,
  Health,
  PipelinePreset,
  PresetSteps,
  Run,
  Skill,
  SkillScope,
  StepMode,
  StreamMessage,
  TaskPlan,
  TeamMember,
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
  workflowTemplate: (name: string) =>
    request<Workflow>(`/api/workflows/template?name=${encodeURIComponent(name)}`),
  publishWorkflow: (body: { name: string; description: string; steps: WorkflowStep[] }) =>
    request<Workflow>('/api/workflows', { method: 'POST', body: JSON.stringify(body) }),
  saveWorkflow: (
    id: string,
    body: { name: string; description: string; steps: WorkflowStep[] },
  ) => request<Workflow>(`/api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteWorkflow: (id: string) => request<{ ok: true }>(`/api/workflows/${id}`, { method: 'DELETE' }),
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
    options?: {
      roleIds?: string[]
      projectPath?: string
      projectId?: string
      mapPath?: string
      deepThinking?: boolean
    },
  ) =>
    request<Run>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflowId,
        task,
        roleIds: options?.roleIds,
        projectPath: options?.projectPath ?? null,
        projectId: options?.projectId ?? null,
        mapPath: options?.mapPath ?? null,
        deepThinking: options?.deepThinking === true,
      }),
    }),
  projects: () => request<SavedProject[]>('/api/projects'),
  addProject: (body: { kind: SavedProjectKind; path: string }) =>
    request<SavedProject>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  pickProjectPath: (body: { kind: SavedProjectKind }) =>
    request<{ cancelled: true } | { path: string }>('/api/projects/pick-path', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProjectAlias: (id: string, alias: string) =>
    request<SavedProject>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ alias }),
    }),
  removeProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  saveRunPlan: (id: string, plan: TaskPlan) =>
    request<Run>(`/api/runs/${id}/plan`, {
      method: 'POST',
      body: JSON.stringify(plan),
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
  stop: (id: string) => request<Run>(`/api/runs/${id}/stop`, { method: 'POST' }),
  retryRun: (id: string) => request<Run>(`/api/runs/${id}/retry`, { method: 'POST' }),
  cursor: () => request<CursorConnection>('/api/settings/cursor'),
  startCursorCliLogin: () =>
    request<CursorConnection>('/api/settings/cursor/cli/login', { method: 'POST' }),
  logoutCursorCliSession: () =>
    request<CursorConnection>('/api/settings/cursor/cli/logout', { method: 'POST' }),
  saveCursor: (token: string) =>
    request<CursorConnection>('/api/settings/cursor', {
      method: 'PUT',
      body: JSON.stringify({ token }),
    }),
  saveCursorCliKey: (apiKey: string) =>
    request<CursorConnection>('/api/settings/cursor', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),
  clearCursor: () => request<CursorConnection>('/api/settings/cursor', { method: 'DELETE' }),
  saveCursorMode: (mode: CursorConnectionMode) =>
    request<CursorConnection>('/api/settings/cursor/mode', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
  board: () => request<BoardTask[]>('/api/board'),
  createTask: (body: {
    title: string
    description: string
    projectId: string
    team?: TeamMember[]
    workflowId?: string
  }) => request<BoardTask>('/api/board', { method: 'POST', body: JSON.stringify(body) }),
  moveTask: (id: string, status: BoardStatus) =>
    request<BoardTask>(`/api/board/${id}/move`, { method: 'POST', body: JSON.stringify({ status }) }),
  saveBoardPlan: (id: string, text: string) =>
    request<BoardTask>(`/api/board/${id}/plan`, { method: 'PUT', body: JSON.stringify({ text }) }),
  handPlan: (id: string, text: string) =>
    request<BoardTask>(`/api/board/${id}/build`, { method: 'POST', body: JSON.stringify({ text }) }),
  completeTask: (id: string) =>
    request<BoardTask>(`/api/board/${id}/complete`, { method: 'POST', body: '{}' }),
  reopenTask: (id: string, note: string) =>
    request<BoardTask>(`/api/board/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  answerTask: (id: string, text: string) =>
    request<{ task: BoardTask; run: Run }>(`/api/board/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  /** Списки .cursor. Пустая папка возвращает предложение, не создавая файлов. */
  cursorProject: (folder: string) =>
    request<CursorProjectView>(`/api/project/cursor?folder=${encodeURIComponent(folder)}`),
  cursorFile: (folder: string, item: { kind: CursorFileKind; name: string; relativePath: string }) => {
    const query = new URLSearchParams({
      folder,
      kind: item.kind,
      name: item.name,
      path: item.relativePath,
    })
    return request<CursorFileDocument>(`/api/project/cursor/file?${query.toString()}`)
  },
  saveCursorFile: (body: {
    folder: string
    kind: CursorFileKind
    name: string
    content: string
    relativePath?: string | null
  }) => request<CursorFileDocument>('/api/project/cursor/file', { method: 'PUT', body: JSON.stringify(body) }),
  addRecommendation: (folder: string) =>
    request<CursorRecommendation>('/api/project/cursor/recommendation', {
      method: 'POST',
      body: JSON.stringify({ folder }),
    }),
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
