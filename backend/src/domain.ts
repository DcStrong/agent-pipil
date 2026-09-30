/** Модель локального оркестратора: агенты, шаги, точки проверки и запуски. */

export type AgentKind = 'planner' | 'builder' | 'reviewer' | 'custom';
export type Harness = 'simulated' | 'cursor';
export type StepMode = 'automatic' | 'approval';
export type SkillScope = 'shared' | 'agent';
export type RunStatus = 'running' | 'waiting_approval' | 'completed' | 'failed';
export type RunEventKind =
  'progress' | 'handoff' | 'approval' | 'error' | 'done';

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  instructions: string;
  harness: Harness;
}

export interface Skill {
  id: string;
  name: string;
  instructions: string;
  scope: SkillScope;
  agentId: string | null;
}

export interface WorkflowStep {
  id: string;
  agentId: string;
  title: string;
  mode: StepMode;
  handoff: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface AgentSkillSnapshot {
  name: string;
  instructions: string;
  scope: SkillScope;
}

export interface RunStep {
  stepId: string;
  agentId: string;
  agentName: string;
  title: string;
  mode: StepMode;
  handoff: string;
  instructions: string;
  harness: Harness;
  skills: AgentSkillSnapshot[];
}

export interface StepWork {
  stepId: string;
  agentId: string;
  agentName: string;
  title: string;
  output: string;
  summary: string;
  startedAt: string;
  finishedAt: string;
}

export interface RunEvent {
  id: string;
  at: string;
  kind: RunEventKind;
  message: string;
  stepIndex: number | null;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string;
  status: RunStatus;
  stepIndex: number | null;
  steps: RunStep[];
  work: StepWork[];
  events: RunEvent[];
  finalResult: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface State {
  agents: Agent[];
  skills: Skill[];
  workflows: Workflow[];
  runs: Run[];
  /** Секрет хранится только на сервере и не уходит в браузер целиком. */
  cursorToken: string | null;
}

export interface AgentContext {
  agentName: string;
  title: string;
  instructions: string;
  skills: AgentSkillSnapshot[];
  task: string;
  priorWork: Array<{ title: string; agentName: string; output: string }>;
  incomingHandoff: string | null;
  outgoingHandoff: string;
  isFinalStep: boolean;
  requiresApproval: boolean;
}

export interface AgentTurn {
  output: string;
  summary: string;
}

const PLANNER_INSTRUCTIONS = [
  'Ты планировщик.',
  'Уточни задачу, назови проблему, допущения и критерии готовности.',
  'Не пиши реализацию.',
].join(' ');

const BUILDER_INSTRUCTIONS = [
  'Ты сборщик.',
  'Преврати план в конкретные изменения и проверку.',
  'Не расширяй задачу.',
].join(' ');

const REVIEWER_INSTRUCTIONS = [
  'Ты ревьюер.',
  'Сверь работу с исходной задачей.',
  'Закончи разделом «Итог», который можно прочитать отдельно.',
].join(' ');

export function createSeedState(): State {
  return {
    agents: [
      {
        id: 'agent_planner',
        name: 'Планировщик',
        kind: 'planner',
        instructions: PLANNER_INSTRUCTIONS,
        harness: 'simulated',
      },
      {
        id: 'agent_builder',
        name: 'Сборщик',
        kind: 'builder',
        instructions: BUILDER_INSTRUCTIONS,
        harness: 'cursor',
      },
      {
        id: 'agent_reviewer',
        name: 'Ревьюер',
        kind: 'reviewer',
        instructions: REVIEWER_INSTRUCTIONS,
        harness: 'simulated',
      },
    ],
    skills: [
      {
        id: 'skill_scope',
        name: 'Держать рамку',
        instructions: 'Делай только то, что написано в задаче.',
        scope: 'shared',
        agentId: null,
      },
      {
        id: 'skill_handoff',
        name: 'Писать для передачи',
        instructions:
          'Оставь короткую заметку, с которой следующий агент продолжит без повтора задачи.',
        scope: 'shared',
        agentId: null,
      },
      {
        id: 'skill_planner',
        name: 'Отделить факты',
        instructions: 'Отметь, что сказано в задаче, а что ты допускаешь.',
        scope: 'agent',
        agentId: 'agent_planner',
      },
      {
        id: 'skill_builder',
        name: 'Назвать изменения',
        instructions:
          'Назови шаги, границы и проверку. Не останавливайся на лозунге.',
        scope: 'agent',
        agentId: 'agent_builder',
      },
      {
        id: 'skill_reviewer',
        name: 'Дать вердикт',
        instructions:
          'Скажи: принять, принять с замечаниями или вернуть, и почему.',
        scope: 'agent',
        agentId: 'agent_reviewer',
      },
    ],
    workflows: [
      {
        id: 'workflow_supervised',
        name: 'Сборка с проверкой',
        description:
          'План и сборка идут сами. Проверка ждёт подтверждения владельца.',
        steps: [
          {
            id: 'step_plan',
            agentId: 'agent_planner',
            title: 'План',
            mode: 'automatic',
            handoff:
              'Передай проблему, допущения и критерии готовности. Способ реализации не выбирай.',
          },
          {
            id: 'step_build',
            agentId: 'agent_builder',
            title: 'Сборка',
            mode: 'automatic',
            handoff:
              'Передай, что меняется, где риск и как проверить результат.',
          },
          {
            id: 'step_review',
            agentId: 'agent_reviewer',
            title: 'Проверка',
            mode: 'approval',
            handoff: '',
          },
        ],
      },
    ],
    runs: [],
    cursorToken: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(label: string): never {
  throw new Error(`Состояние: ${label}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(label);
  return value;
}

function agentKind(value: unknown): AgentKind {
  if (
    value === 'planner' ||
    value === 'builder' ||
    value === 'reviewer' ||
    value === 'custom'
  ) {
    return value;
  }
  return fail('тип агента');
}

function harness(value: unknown): Harness {
  if (value === 'simulated' || value === 'cursor') return value;
  return fail('среда агента');
}

function stepMode(value: unknown): StepMode {
  if (value === 'automatic' || value === 'approval') return value;
  return fail('режим шага');
}

function skillScope(value: unknown): SkillScope {
  if (value === 'shared' || value === 'agent') return value;
  return fail('область навыка');
}

function parseAgent(value: unknown): Agent {
  if (!isRecord(value)) fail('агент');
  return {
    id: text(value.id, 'id агента'),
    name: text(value.name, 'имя агента'),
    kind: agentKind(value.kind),
    instructions: text(value.instructions, 'инструкции'),
    harness: harness(value.harness),
  };
}

function parseSkill(value: unknown): Skill {
  if (!isRecord(value)) fail('навык');
  const agentId = value.agentId;
  if (agentId !== null && typeof agentId !== 'string') fail('агент навыка');
  return {
    id: text(value.id, 'id навыка'),
    name: text(value.name, 'имя навыка'),
    instructions: text(value.instructions, 'инструкции навыка'),
    scope: skillScope(value.scope),
    agentId,
  };
}

function parseStep(value: unknown): WorkflowStep {
  if (!isRecord(value)) fail('шаг');
  return {
    id: text(value.id, 'id шага'),
    agentId: text(value.agentId, 'агент шага'),
    title: text(value.title, 'название шага'),
    mode: stepMode(value.mode),
    handoff: text(value.handoff, 'передача'),
  };
}

function parseWorkflow(value: unknown): Workflow {
  if (!isRecord(value) || !Array.isArray(value.steps)) fail('процесс');
  return {
    id: text(value.id, 'id процесса'),
    name: text(value.name, 'имя процесса'),
    description: text(value.description, 'описание процесса'),
    steps: value.steps.map(parseStep),
  };
}

function parseSnapshotSkill(value: unknown): AgentSkillSnapshot {
  if (!isRecord(value)) fail('навык запуска');
  return {
    name: text(value.name, 'имя навыка запуска'),
    instructions: text(value.instructions, 'инструкции навыка запуска'),
    scope: skillScope(value.scope),
  };
}

function parseRunStep(value: unknown): RunStep {
  if (!isRecord(value) || !Array.isArray(value.skills)) fail('шаг запуска');
  return {
    stepId: text(value.stepId, 'id шага запуска'),
    agentId: text(value.agentId, 'агент запуска'),
    agentName: text(value.agentName, 'имя агента запуска'),
    title: text(value.title, 'название шага запуска'),
    mode: stepMode(value.mode),
    handoff: text(value.handoff, 'передача запуска'),
    instructions: text(value.instructions, 'инструкции запуска'),
    harness: harness(value.harness),
    skills: value.skills.map(parseSnapshotSkill),
  };
}

function parseWork(value: unknown): StepWork {
  if (!isRecord(value)) fail('результат шага');
  return {
    stepId: text(value.stepId, 'шаг результата'),
    agentId: text(value.agentId, 'агент результата'),
    agentName: text(value.agentName, 'имя результата'),
    title: text(value.title, 'название результата'),
    output: text(value.output, 'текст результата'),
    summary: text(value.summary, 'сводка'),
    startedAt: text(value.startedAt, 'начало'),
    finishedAt: text(value.finishedAt, 'конец'),
  };
}

function parseEvent(value: unknown): RunEvent {
  if (!isRecord(value)) fail('событие');
  const kind = value.kind;
  if (
    kind !== 'progress' &&
    kind !== 'handoff' &&
    kind !== 'approval' &&
    kind !== 'error' &&
    kind !== 'done'
  ) {
    fail('вид события');
  }
  const stepIndex = value.stepIndex;
  if (stepIndex !== null && typeof stepIndex !== 'number')
    fail('индекс события');
  return {
    id: text(value.id, 'id события'),
    at: text(value.at, 'время события'),
    kind,
    message: text(value.message, 'текст события'),
    stepIndex,
  };
}

function parseRun(value: unknown): Run {
  if (
    !isRecord(value) ||
    !Array.isArray(value.steps) ||
    !Array.isArray(value.work) ||
    !Array.isArray(value.events)
  ) {
    fail('запуск');
  }
  const status = value.status;
  if (
    status !== 'running' &&
    status !== 'waiting_approval' &&
    status !== 'completed' &&
    status !== 'failed'
  ) {
    fail('статус запуска');
  }
  const stepIndex = value.stepIndex;
  if (stepIndex !== null && typeof stepIndex !== 'number') fail('текущий шаг');
  const finalResult = value.finalResult;
  const error = value.error;
  const finishedAt = value.finishedAt;
  if (finalResult !== null && typeof finalResult !== 'string') fail('итог');
  if (error !== null && typeof error !== 'string') fail('ошибка запуска');
  if (finishedAt !== null && typeof finishedAt !== 'string')
    fail('время окончания');
  return {
    id: text(value.id, 'id запуска'),
    workflowId: text(value.workflowId, 'процесс запуска'),
    workflowName: text(value.workflowName, 'имя процесса запуска'),
    task: text(value.task, 'задача'),
    status,
    stepIndex,
    steps: value.steps.map(parseRunStep),
    work: value.work.map(parseWork),
    events: value.events.map(parseEvent),
    finalResult,
    error,
    createdAt: text(value.createdAt, 'создание запуска'),
    updatedAt: text(value.updatedAt, 'обновление запуска'),
    finishedAt,
  };
}

export function parseState(value: unknown): State {
  if (
    !isRecord(value) ||
    !Array.isArray(value.agents) ||
    !Array.isArray(value.skills) ||
    !Array.isArray(value.workflows) ||
    !Array.isArray(value.runs)
  ) {
    fail('файл');
  }
  const cursorToken = value.cursorToken;
  if (cursorToken !== null && typeof cursorToken !== 'string') fail('токен');
  return {
    agents: value.agents.map(parseAgent),
    skills: value.skills.map(parseSkill),
    workflows: value.workflows.map(parseWorkflow),
    runs: value.runs.map(parseRun),
    cursorToken,
  };
}

/** Последние 4 символа. Полный токен наружу не отдаём. */
export function tokenHint(token: string): string | null {
  if (token.length < 8) return null;
  return `••••${token.slice(-4)}`;
}
