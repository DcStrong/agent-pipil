/**
 * Задачи доски и план.
 * Статусы колонок остаются new, in_progress, review.
 * Режим вопроса не заставляет проходить план. Если план есть, порядок один:
 * правка, затем сборка, затем проверка. Перескочить его нельзя.
 */

export type BoardStatus = 'new' | 'in_progress' | 'review' | 'completed';

/** ask — вопрос без плана, plan — план до сборки, agent — работа по плану или сразу. */
export type WorkMode = 'ask' | 'plan' | 'agent';

/** idle — ещё в «новых». plan — план открыт для правки. build — план уже отдан. */
export type BoardPhase = 'idle' | 'working' | 'plan' | 'build' | 'done';

export type MemberState = 'working' | 'waiting' | 'done';

export interface TeamMember {
  agentId: string;
  mode: WorkMode;
}

export interface BoardActivity {
  agentId: string;
  agentName: string;
  mode: WorkMode;
  state: MemberState;
  note: string;
}

export interface BoardPlan {
  text: string;
  authorAgentId: string;
  authorName: string;
  /** Пока план не отдан в сборку, текст можно менять. */
  editable: boolean;
  updatedAt: string;
}

export interface TaskUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  chargedCents: number | null;
}

export interface RunUsageState {
  known: boolean;
  totals: TaskUsageTotals | null;
}

export interface BoardTask {
  id: string;
  title: string;
  description: string;
  status: BoardStatus;
  /** Сохранённый проект или workspace для живого запуска. */
  projectId: string;
  projectLabel: string;
  /** Если задан — команда взята из процесса на холсте. */
  workflowId: string | null;
  workflowName: string | null;
  /** Запуск оркестратора, созданный при переносе в «В работу». */
  runId: string | null;
  team: TeamMember[];
  phase: BoardPhase;
  activity: BoardActivity[];
  plan: BoardPlan | null;
  /** Копия расхода связанного запуска; обновляется backend. */
  usage?: RunUsageState;
  createdAt: string;
  updatedAt: string;
}

/** Архитектор и планировщик чаще всего ведут план. Остальные по умолчанию не обязаны. */
export function defaultWorkMode(kind: string): WorkMode {
  if (kind === 'architect' || kind === 'planner') return 'plan';
  if (kind === 'developer' || kind === 'builder' || kind === 'reviewer') {
    return 'agent';
  }
  return 'ask';
}

export function draftPlan(
  title: string,
  description: string,
  authorName: string,
): string {
  const body = description.trim() || 'Описание не задано.';
  return [
    `# ${title}`,
    '',
    body,
    '',
    '## Шаги',
    '1. Зафиксировать рамку задачи и не расширять её.',
    '2. Собрать только то, что останется в этом тексте после правки.',
    '3. Сверить результат с рамкой.',
    '',
    `План составил ${authorName}. Текст можно править. В сборку он уходит только отсюда, проверка раньше сборки не начинается.`,
  ].join('\n');
}

interface NamedAgent {
  id: string;
  kind: string;
  name: string;
}

/** Автор плана: сначала архитектор, затем планировщик, иначе любой агент в режиме плана. */
export function choosePlanAuthor<T extends NamedAgent>(
  team: TeamMember[],
  agents: T[],
): T | null {
  const planners = team
    .filter((member) => member.mode === 'plan')
    .map((member) => agents.find((agent) => agent.id === member.agentId))
    .filter((agent): agent is T => Boolean(agent));
  return (
    planners.find((agent) => agent.kind === 'architect') ??
    planners.find((agent) => agent.kind === 'planner') ??
    planners[0] ??
    null
  );
}

function fail(label: string): never {
  throw new Error(`Состояние: ${label}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(label);
  return value;
}

function boardStatus(value: unknown): BoardStatus {
  if (
    value === 'new' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'completed'
  ) {
    return value;
  }
  return fail('статус задачи');
}

function workMode(value: unknown): WorkMode {
  if (value === 'ask' || value === 'plan' || value === 'agent') return value;
  return fail('режим агента');
}

function boardPhase(value: unknown): BoardPhase {
  if (
    value === 'idle' ||
    value === 'working' ||
    value === 'plan' ||
    value === 'build' ||
    value === 'done'
  ) {
    return value;
  }
  return fail('фаза задачи');
}

function memberState(value: unknown): MemberState {
  if (value === 'working' || value === 'waiting' || value === 'done') {
    return value;
  }
  return fail('состояние участника');
}

function parseMember(value: unknown): TeamMember {
  if (!isRecord(value)) fail('участник');
  return {
    agentId: text(value.agentId, 'агент участника'),
    mode: workMode(value.mode),
  };
}

function parseActivity(value: unknown): BoardActivity {
  if (!isRecord(value)) fail('ход команды');
  return {
    agentId: text(value.agentId, 'агент хода'),
    agentName: text(value.agentName, 'имя хода'),
    mode: workMode(value.mode),
    state: memberState(value.state),
    note: text(value.note, 'заметка хода'),
  };
}

function parseNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(label);
  return value;
}

function parseUsageTotals(value: unknown): TaskUsageTotals | null {
  if (value == null) return null;
  if (!isRecord(value)) fail('расход задачи');
  const charged = value.chargedCents;
  if (charged !== null && charged !== undefined && typeof charged !== 'number') {
    fail('стоимость расхода');
  }
  return {
    inputTokens: parseNumber(value.inputTokens, 'входные токены'),
    outputTokens: parseNumber(value.outputTokens, 'выходные токены'),
    cacheReadTokens: parseNumber(value.cacheReadTokens, 'кэш чтение'),
    cacheWriteTokens: parseNumber(value.cacheWriteTokens, 'кэш запись'),
    totalTokens: parseNumber(value.totalTokens, 'всего токенов'),
    chargedCents:
      charged === undefined || charged === null ? null : charged,
  };
}

function parseRunUsageState(value: unknown): RunUsageState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail('сводка расхода');
  if (typeof value.known !== 'boolean') fail('признак расхода');
  const totals =
    value.totals === undefined || value.totals === null
      ? null
      : parseUsageTotals(value.totals);
  return { known: value.known, totals };
}

function parsePlan(value: unknown): BoardPlan | null {
  if (value == null) return null;
  if (!isRecord(value)) fail('план');
  return {
    text: text(value.text, 'текст плана'),
    authorAgentId: text(value.authorAgentId, 'автор плана'),
    authorName: text(value.authorName, 'имя автора плана'),
    editable: value.editable === true,
    updatedAt: text(value.updatedAt, 'правка плана'),
  };
}

function parseTask(value: unknown): BoardTask {
  if (!isRecord(value) || !Array.isArray(value.team)) fail('задача доски');
  const workflowId = value.workflowId;
  const workflowName = value.workflowName;
  return {
    id: text(value.id, 'id задачи'),
    title: text(value.title, 'название задачи'),
    description: text(value.description, 'описание задачи'),
    status: boardStatus(value.status),
    projectId:
      typeof value.projectId === 'string' ? value.projectId : '',
    projectLabel:
      typeof value.projectLabel === 'string' ? value.projectLabel : '',
    workflowId:
      workflowId === null || workflowId === undefined
        ? null
        : text(workflowId, 'процесс задачи'),
    workflowName:
      workflowName === null || workflowName === undefined
        ? null
        : text(workflowName, 'имя процесса задачи'),
    runId:
      value.runId === null ||
      value.runId === undefined ||
      value.runId === ''
        ? null
        : text(value.runId, 'запуск задачи'),
    team: value.team.map(parseMember),
    phase: boardPhase(value.phase),
    activity: Array.isArray(value.activity)
      ? value.activity.map(parseActivity)
      : [],
    plan: parsePlan(value.plan),
    usage: parseRunUsageState(value.usage),
    createdAt: text(value.createdAt, 'создание задачи'),
    updatedAt: text(value.updatedAt, 'обновление задачи'),
  };
}

/** Старый файл без доски остаётся годным: задач просто нет. */
export function parseBoardTasks(value: unknown): BoardTask[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('доска');
  return value.map(parseTask);
}
