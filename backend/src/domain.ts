/** Модель локального оркестратора: агенты, шаги, точки проверки и запуски. */

export type AgentKind =
  | 'orchestrator'
  | 'analyst'
  | 'architect'
  | 'developer'
  | 'tester'
  | 'planner'
  | 'builder'
  | 'reviewer'
  | 'custom';
export type Harness = 'simulated' | 'cursor';
export type StepMode =
  'automatic' | 'approval' | 'question' | 'ask' | 'plan' | 'build' | 'review';
export type SkillScope = 'shared' | 'agent';
export type RunStatus =
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'waiting_plan'
  | 'completed'
  | 'failed';
export type RunEventKind =
  'progress' | 'handoff' | 'approval' | 'question' | 'error' | 'done';
export type ReturnShape = 'object' | 'array' | 'none';
export type DialogueAuthor = 'role' | 'user' | 'handoff';

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
  /** Куда ведёт шаг. Пустой список у всех шагов значит прежнюю цепочку по порядку. */
  nextIds: string[];
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

/** Короткая передача: цель, что уже решено, что делать сейчас. Чужой диалог сюда не входит. */
export interface HandoffBrief {
  goal: string;
  decided: string;
  now: string;
}

/** Четыре короткие части плана. Их можно поправить до сборки. */
export interface TaskPlan {
  why: string;
  changes: string;
  how: string;
  checklist: string;
}

/** План и результат уходят в архив этой задачи, а не в следующий диалог. */
export interface TaskArchive {
  note: string;
  plan: TaskPlan;
  result: string;
  at: string;
  folder: string | null;
}

export interface DialogueMessage {
  id: string;
  at: string;
  author: DialogueAuthor;
  text: string;
}

/** Снимок папки проекта. В диалог попадают пути, а не текст правил и навыков. */
export interface ProjectSnapshot {
  folder: string | null;
  available: boolean;
  rules: string[];
  skills: string[];
  commands: string[];
  mapPath: string | null;
  mapText: string | null;
  mapMissing: boolean;
  pointedAtMap: boolean;
  surveyed: boolean;
  survey: string[];
  tests: string[];
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
  /** Новый диалог на каждую задачу. Старые запуски его не переиспользуют. */
  dialogueId: string;
  kind: AgentKind;
  messages: DialogueMessage[];
  brief: HandoffBrief | null;
  question: string | null;
  mapAddition: string | null;
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
  project: ProjectSnapshot | null;
  /** Какой формы объект вернул разработчик в последний раз. */
  developerShape: ReturnShape;
  pendingQuestion: string | null;
  mapWritten: boolean;
  mapNote: string | null;
  /** Галка на задаче. Выключена — агенты берут задачу сразу. */
  deepThinking: boolean;
  /** Короткая заметка, что уже есть. Пустая, если галка выключена. */
  note: string | null;
  plan: TaskPlan | null;
  /** Текст сборки. Контекст — план, если план есть. */
  buildText: string | null;
  reviewText: string | null;
  /** Папка задачи в проекте. Без папки проекта части лежат на самой задаче. */
  taskFolder: string | null;
  archive: TaskArchive | null;
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
  kind: AgentKind;
  brief: HandoffBrief | null;
  answer: string | null;
  project: ProjectSnapshot | null;
  developerShape: ReturnShape;
  developerPasses: number;
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

const ROLE_ORDER: AgentKind[] = [
  'orchestrator',
  'analyst',
  'architect',
  'developer',
  'tester',
];

/** Четыре рабочие роли и отдельный тестировщик. Имена можно править вручную. */
export function seedRoles(): Agent[] {
  return [
    {
      id: 'role_orchestrator',
      name: 'Оркестратор',
      kind: 'orchestrator',
      harness: 'simulated',
      instructions: [
        'Ты оркестратор.',
        'На каждую задачу у тебя новый диалог.',
        'Передавай дальше только цель, уже принятое решение и следующий шаг.',
        'Не отвечай за владельца, если роль задала вопрос.',
        'Карту проекта пишешь только ты и только в конце, если она изменилась.',
        'Навыки, команды и правила из .cursor в сообщения не копируй.',
      ].join(' '),
    },
    {
      id: 'role_analyst',
      name: 'Аналитик',
      kind: 'analyst',
      harness: 'simulated',
      instructions: [
        'Ты аналитик.',
        'Держись задачи и карты проекта.',
        'Чужой диалог не продолжай: бери только короткую передачу.',
        'Если карте чего-то не хватает, сообщи, что добавить. Сам файл не пиши.',
      ].join(' '),
    },
    {
      id: 'role_architect',
      name: 'Архитектор',
      kind: 'architect',
      harness: 'simulated',
      instructions: [
        'Ты архитектор.',
        'Если без владельца нельзя выбрать контракт, спроси и жди.',
        'Не придумывай ответ за него.',
        'В передаче оставь только цель, решение и что делать сейчас.',
      ].join(' '),
    },
    {
      id: 'role_developer',
      name: 'Бэкенд-разработчик',
      kind: 'developer',
      harness: 'simulated',
      instructions: [
        'Ты бэкенд-разработчик.',
        'Делай только то, что уже решено в передаче.',
        'Если тестировщик вернул несовпадение контракта, поправь ответ, а не спор.',
      ].join(' '),
    },
    {
      id: 'role_tester',
      name: 'Тестировщик',
      kind: 'tester',
      harness: 'simulated',
      instructions: [
        'Ты тестировщик.',
        'Можно читать весь проект, включая внешние края вроде Rabbit.',
        'Чужие диалоги читать нельзя.',
        'Сначала ищи существующие тесты и прогоняй их.',
        'Если тестов нет, напиши и прогони.',
        'Если падающий тест не про контракт задачи, исправь тест.',
        'Если код вернул не ту форму, верни это разработчику.',
      ].join(' '),
    },
  ];
}

export function roleOrder(kind: AgentKind): number {
  const index = ROLE_ORDER.indexOf(kind);
  return index === -1 ? ROLE_ORDER.length : index;
}

/** Добавляет недостающие роли в уже сохранённое состояние, не трогая процессы. */
export function ensureSeedRoles(state: State): boolean {
  let changed = false;
  for (const role of seedRoles()) {
    if (state.agents.some((agent) => agent.id === role.id)) continue;
    state.agents.push(role);
    changed = true;
  }
  return changed;
}

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
      ...seedRoles(),
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
            nextIds: [],
          },
          {
            id: 'step_build',
            agentId: 'agent_builder',
            title: 'Сборка',
            mode: 'automatic',
            handoff:
              'Передай, что меняется, где риск и как проверить результат.',
            nextIds: [],
          },
          {
            id: 'step_review',
            agentId: 'agent_reviewer',
            title: 'Проверка',
            mode: 'approval',
            handoff: '',
            nextIds: [],
          },
        ],
      },
    ],
    runs: [],
    cursorToken: null,
  };
}

export function emptyProject(): ProjectSnapshot {
  return {
    folder: null,
    available: false,
    rules: [],
    skills: [],
    commands: [],
    mapPath: null,
    mapText: null,
    mapMissing: true,
    pointedAtMap: false,
    surveyed: false,
    survey: [],
    tests: [],
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
    value === 'orchestrator' ||
    value === 'analyst' ||
    value === 'architect' ||
    value === 'developer' ||
    value === 'tester' ||
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
  if (
    value === 'automatic' ||
    value === 'approval' ||
    value === 'question' ||
    value === 'ask' ||
    value === 'plan' ||
    value === 'build' ||
    value === 'review'
  ) {
    return value;
  }
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
    nextIds: Array.isArray(value.nextIds)
      ? value.nextIds.filter((id): id is string => typeof id === 'string')
      : [],
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

function parseAuthor(value: unknown): DialogueAuthor {
  if (value === 'role' || value === 'user' || value === 'handoff') return value;
  return fail('автор реплики');
}

function parseMessage(value: unknown): DialogueMessage {
  if (!isRecord(value)) fail('реплика');
  return {
    id: text(value.id, 'id реплики'),
    at: text(value.at, 'время реплики'),
    author: parseAuthor(value.author),
    text: text(value.text, 'текст реплики'),
  };
}

function parseBrief(value: unknown): HandoffBrief | null {
  if (value == null) return null;
  if (!isRecord(value)) fail('передача');
  return {
    goal: text(value.goal, 'цель передачи'),
    decided: text(value.decided, 'решение передачи'),
    now: text(value.now, 'шаг передачи'),
  };
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(label);
  return value.map((item) => text(item, label));
}

function parseProject(value: unknown): ProjectSnapshot | null {
  if (value == null) return null;
  if (!isRecord(value)) fail('проект');
  const folder = value.folder;
  if (folder !== null && typeof folder !== 'string') fail('папка проекта');
  const mapPath = value.mapPath;
  const mapText = value.mapText;
  if (mapPath !== null && typeof mapPath !== 'string') fail('путь карты');
  if (mapText !== null && typeof mapText !== 'string') fail('текст карты');
  return {
    folder,
    available: value.available === true,
    rules: parseStringList(value.rules ?? [], 'правила'),
    skills: parseStringList(value.skills ?? [], 'навыки проекта'),
    commands: parseStringList(value.commands ?? [], 'команды'),
    mapPath,
    mapText,
    mapMissing: value.mapMissing !== false,
    pointedAtMap: value.pointedAtMap === true,
    surveyed: value.surveyed === true,
    survey: parseStringList(value.survey ?? [], 'обзор'),
    tests: parseStringList(value.tests ?? [], 'тесты'),
  };
}

function parseShape(value: unknown): ReturnShape {
  if (value === 'object' || value === 'array' || value === 'none') return value;
  return 'none';
}

function parsePlan(value: unknown): TaskPlan | null {
  if (value == null) return null;
  if (!isRecord(value)) fail('план задачи');
  return {
    why: text(value.why, 'зачем'),
    changes: text(value.changes, 'изменения'),
    how: text(value.how, 'как'),
    checklist: text(value.checklist, 'чеклист'),
  };
}

function parseArchive(value: unknown): TaskArchive | null {
  if (value == null) return null;
  if (!isRecord(value)) fail('архив задачи');
  const plan = parsePlan(value.plan);
  if (!plan) fail('план архива');
  const folder = value.folder;
  if (folder !== null && typeof folder !== 'string') fail('папка архива');
  return {
    note: text(value.note, 'заметка архива'),
    plan,
    result: text(value.result, 'итог архива'),
    at: text(value.at, 'время архива'),
    folder,
  };
}

function parseRunStep(value: unknown): RunStep {
  if (!isRecord(value) || !Array.isArray(value.skills)) fail('шаг запуска');
  const stepId = text(value.stepId, 'id шага запуска');
  const messages = Array.isArray(value.messages)
    ? value.messages.map(parseMessage)
    : [];
  return {
    stepId,
    agentId: text(value.agentId, 'агент запуска'),
    agentName: text(value.agentName, 'имя агента запуска'),
    title: text(value.title, 'название шага запуска'),
    mode: stepMode(value.mode),
    handoff: text(value.handoff, 'передача запуска'),
    instructions: text(value.instructions, 'инструкции запуска'),
    harness: harness(value.harness),
    skills: value.skills.map(parseSnapshotSkill),
    dialogueId:
      typeof value.dialogueId === 'string' && value.dialogueId
        ? value.dialogueId
        : stepId,
    kind: value.kind === undefined ? 'custom' : agentKind(value.kind),
    messages,
    brief: parseBrief(value.brief),
    question: typeof value.question === 'string' ? value.question : null,
    mapAddition:
      typeof value.mapAddition === 'string' ? value.mapAddition : null,
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
    kind !== 'question' &&
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
    status !== 'waiting_user' &&
    status !== 'waiting_plan' &&
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
    project: value.project === undefined ? null : parseProject(value.project),
    developerShape: parseShape(value.developerShape),
    pendingQuestion:
      typeof value.pendingQuestion === 'string' ? value.pendingQuestion : null,
    mapWritten: value.mapWritten === true,
    mapNote: typeof value.mapNote === 'string' ? value.mapNote : null,
    deepThinking: value.deepThinking === true,
    note: typeof value.note === 'string' ? value.note : null,
    plan: value.plan === undefined ? null : parsePlan(value.plan),
    buildText: typeof value.buildText === 'string' ? value.buildText : null,
    reviewText: typeof value.reviewText === 'string' ? value.reviewText : null,
    taskFolder: typeof value.taskFolder === 'string' ? value.taskFolder : null,
    archive: value.archive === undefined ? null : parseArchive(value.archive),
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
