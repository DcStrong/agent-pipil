export type SkillScope = 'shared' | 'role';

export interface Role {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface Skill {
  id: string;
  name: string;
  instructions: string;
  scope: SkillScope;
  roleId: string | null;
}

export interface PipelineStage {
  id: string;
  roleId: string;
  handoffInstruction: string;
}

export interface AgentSkill {
  name: string;
  instructions: string;
  scope: SkillScope;
}

export interface RunStageSnapshot {
  stageId: string;
  roleId: string;
  roleName: string;
  systemPrompt: string;
  handoffInstruction: string;
  skills: AgentSkill[];
}

export interface StageWork {
  stageId: string;
  roleId: string;
  roleName: string;
  output: string;
  summary: string;
  startedAt: string;
  finishedAt: string;
}

export type RunEventKind =
  'started' | 'stage_started' | 'handoff' | 'completed' | 'failed';

export interface RunEvent {
  id: string;
  at: string;
  kind: RunEventKind;
  message: string;
  stageIndex: number | null;
  roleId: string | null;
}

export type RunStatus = 'running' | 'completed' | 'failed';

export interface Run {
  id: string;
  task: string;
  status: RunStatus;
  stageIndex: number | null;
  ownerRoleId: string | null;
  ownerName: string | null;
  stages: RunStageSnapshot[];
  work: StageWork[];
  events: RunEvent[];
  finalResult: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface State {
  roles: Role[];
  skills: Skill[];
  stages: PipelineStage[];
  runs: Run[];
}

export interface AgentContext {
  roleName: string;
  systemPrompt: string;
  skills: AgentSkill[];
  task: string;
  priorWork: Array<{ roleName: string; output: string }>;
  incomingHandoff: string | null;
  outgoingHandoff: string;
  isFinalStage: boolean;
}

export interface AgentTurn {
  output: string;
  summary: string;
}

const ANALYST_PROMPT = [
  'You are the analyst.',
  'Clarify the task, name the problem, list assumptions, and write success criteria.',
  'Do not design the system or write an implementation.',
].join(' ');

const ARCHITECT_PROMPT = [
  'You are the architect.',
  'Turn the analysis into a small technical approach: the parts involved, how they connect, and what the developer must not change.',
  'Do not implement the work.',
].join(' ');

const DEVELOPER_PROMPT = [
  'You are the developer.',
  'Turn the approach into concrete changes someone could make, including edge cases.',
  'Stay inside the task. Do not reopen the product scope.',
].join(' ');

const REVIEWER_PROMPT = [
  'You are the reviewer.',
  'Check the earlier work against the original task.',
  'End with a verdict and a final result that can be read on its own.',
].join(' ');

export function createSeedState(): State {
  return {
    roles: [
      {
        id: 'role_analyst',
        name: 'Analyst',
        systemPrompt: ANALYST_PROMPT,
      },
      {
        id: 'role_architect',
        name: 'Architect',
        systemPrompt: ARCHITECT_PROMPT,
      },
      {
        id: 'role_developer',
        name: 'Developer',
        systemPrompt: DEVELOPER_PROMPT,
      },
      {
        id: 'role_reviewer',
        name: 'Reviewer',
        systemPrompt: REVIEWER_PROMPT,
      },
    ],
    skills: [
      {
        id: 'skill_scope',
        name: 'Stay in scope',
        instructions:
          'Only address the task that was sent. Do not add neighboring features.',
        scope: 'shared',
        roleId: null,
      },
      {
        id: 'skill_handoff',
        name: 'Write for the next role',
        instructions:
          'Leave a short section the next role can continue from without asking the user to restate the task.',
        scope: 'shared',
        roleId: null,
      },
      {
        id: 'skill_analyst_facts',
        name: 'Separate facts',
        instructions: 'Mark what the task states and what you are assuming.',
        scope: 'role',
        roleId: 'role_analyst',
      },
      {
        id: 'skill_architect_small',
        name: 'Smallest design',
        instructions:
          'Prefer the smallest approach that meets the success criteria.',
        scope: 'role',
        roleId: 'role_architect',
      },
      {
        id: 'skill_developer_concrete',
        name: 'Name the changes',
        instructions:
          'Name the steps, boundaries, and checks. Do not stop at a slogan.',
        scope: 'role',
        roleId: 'role_developer',
      },
      {
        id: 'skill_reviewer_verdict',
        name: 'Give a verdict',
        instructions:
          'Say approve, approve with notes, or send back, and say why.',
        scope: 'role',
        roleId: 'role_reviewer',
      },
    ],
    stages: [
      {
        id: 'stage_analyst',
        roleId: 'role_analyst',
        handoffInstruction:
          'Pass the problem, the assumptions, and the success criteria. Leave the design open.',
      },
      {
        id: 'stage_architect',
        roleId: 'role_architect',
        handoffInstruction:
          'Pass the approach and the parts to build. Leave the implementation detail to the developer.',
      },
      {
        id: 'stage_developer',
        roleId: 'role_developer',
        handoffInstruction:
          'Pass the changes, the risks, and how to tell the work is done.',
      },
      {
        id: 'stage_reviewer',
        roleId: 'role_reviewer',
        handoffInstruction: '',
      },
    ],
    runs: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`State file has an invalid ${label}.`);
  }
  return value;
}

function parseRole(value: unknown): Role {
  if (!isRecord(value)) throw new Error('State file has an invalid role.');
  return {
    id: readString(value.id, 'role id'),
    name: readString(value.name, 'role name'),
    systemPrompt: readString(value.systemPrompt, 'system prompt'),
  };
}

function parseSkill(value: unknown): Skill {
  if (!isRecord(value)) throw new Error('State file has an invalid skill.');
  const scope = value.scope;
  if (scope !== 'shared' && scope !== 'role') {
    throw new Error('State file has an invalid skill scope.');
  }
  const roleId = value.roleId;
  if (roleId !== null && typeof roleId !== 'string') {
    throw new Error('State file has an invalid skill role.');
  }
  return {
    id: readString(value.id, 'skill id'),
    name: readString(value.name, 'skill name'),
    instructions: readString(value.instructions, 'skill instructions'),
    scope,
    roleId,
  };
}

function parseStage(value: unknown): PipelineStage {
  if (!isRecord(value)) throw new Error('State file has an invalid stage.');
  return {
    id: readString(value.id, 'stage id'),
    roleId: readString(value.roleId, 'stage role'),
    handoffInstruction: readString(value.handoffInstruction, 'handoff'),
  };
}

function parseAgentSkill(value: unknown): AgentSkill {
  if (!isRecord(value)) throw new Error('State file has an invalid run skill.');
  const scope = value.scope;
  if (scope !== 'shared' && scope !== 'role') {
    throw new Error('State file has an invalid run skill.');
  }
  return {
    name: readString(value.name, 'run skill name'),
    instructions: readString(value.instructions, 'run skill instructions'),
    scope,
  };
}

function parseSnapshot(value: unknown): RunStageSnapshot {
  if (!isRecord(value) || !Array.isArray(value.skills)) {
    throw new Error('State file has an invalid run stage.');
  }
  return {
    stageId: readString(value.stageId, 'run stage id'),
    roleId: readString(value.roleId, 'run stage role'),
    roleName: readString(value.roleName, 'run stage name'),
    systemPrompt: readString(value.systemPrompt, 'run stage prompt'),
    handoffInstruction: readString(value.handoffInstruction, 'run handoff'),
    skills: value.skills.map(parseAgentSkill),
  };
}

function parseWork(value: unknown): StageWork {
  if (!isRecord(value)) throw new Error('State file has invalid stage work.');
  return {
    stageId: readString(value.stageId, 'work stage'),
    roleId: readString(value.roleId, 'work role'),
    roleName: readString(value.roleName, 'work role name'),
    output: readString(value.output, 'work output'),
    summary: readString(value.summary, 'work summary'),
    startedAt: readString(value.startedAt, 'work start'),
    finishedAt: readString(value.finishedAt, 'work finish'),
  };
}

function parseEvent(value: unknown): RunEvent {
  if (!isRecord(value)) throw new Error('State file has an invalid run event.');
  const kind = value.kind;
  if (
    kind !== 'started' &&
    kind !== 'stage_started' &&
    kind !== 'handoff' &&
    kind !== 'completed' &&
    kind !== 'failed'
  ) {
    throw new Error('State file has an invalid run event.');
  }
  const stageIndex = value.stageIndex;
  if (stageIndex !== null && typeof stageIndex !== 'number') {
    throw new Error('State file has an invalid run event.');
  }
  const roleId = value.roleId;
  if (roleId !== null && typeof roleId !== 'string') {
    throw new Error('State file has an invalid run event.');
  }
  return {
    id: readString(value.id, 'event id'),
    at: readString(value.at, 'event time'),
    kind,
    message: readString(value.message, 'event message'),
    stageIndex,
    roleId,
  };
}

function parseRun(value: unknown): Run {
  if (
    !isRecord(value) ||
    !Array.isArray(value.stages) ||
    !Array.isArray(value.work) ||
    !Array.isArray(value.events)
  ) {
    throw new Error('State file has an invalid run.');
  }
  const status = value.status;
  if (status !== 'running' && status !== 'completed' && status !== 'failed') {
    throw new Error('State file has an invalid run status.');
  }
  const stageIndex = value.stageIndex;
  if (stageIndex !== null && typeof stageIndex !== 'number') {
    throw new Error('State file has an invalid stage index.');
  }
  const ownerRoleId = value.ownerRoleId;
  const ownerName = value.ownerName;
  const finalResult = value.finalResult;
  const error = value.error;
  if (ownerRoleId !== null && typeof ownerRoleId !== 'string') {
    throw new Error('State file has an invalid owner.');
  }
  if (ownerName !== null && typeof ownerName !== 'string') {
    throw new Error('State file has an invalid owner.');
  }
  if (finalResult !== null && typeof finalResult !== 'string') {
    throw new Error('State file has an invalid final result.');
  }
  if (error !== null && typeof error !== 'string') {
    throw new Error('State file has an invalid run error.');
  }
  return {
    id: readString(value.id, 'run id'),
    task: readString(value.task, 'run task'),
    status,
    stageIndex,
    ownerRoleId,
    ownerName,
    stages: value.stages.map(parseSnapshot),
    work: value.work.map(parseWork),
    events: value.events.map(parseEvent),
    finalResult,
    error,
    createdAt: readString(value.createdAt, 'run created time'),
    updatedAt: readString(value.updatedAt, 'run updated time'),
  };
}

export function parseState(value: unknown): State {
  if (
    !isRecord(value) ||
    !Array.isArray(value.roles) ||
    !Array.isArray(value.skills) ||
    !Array.isArray(value.stages) ||
    !Array.isArray(value.runs)
  ) {
    throw new Error('State file is not a pipeline store.');
  }
  return {
    roles: value.roles.map(parseRole),
    skills: value.skills.map(parseSkill),
    stages: value.stages.map(parseStage),
    runs: value.runs.map(parseRun),
  };
}
