/**
 * Доска задач. Команда стартует при переносе в in_progress.
 * Ход всегда имитация: клиент Cursor здесь не создаётся и сеть не вызывается,
 * даже если у агента среда Cursor и токен уже сохранён.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Agent, StepMode, WorkflowStep } from '../domain';
import { displayName } from '../runtime/saved-project';
import { orderSteps } from '../runtime/step-graph';
import { ProjectsService } from '../projects/projects.service';
import { RunsService } from '../runs/runs.service';
import { readDelayMs } from '../runtime/orchestrator';
import { StoreService } from '../store/store.service';
import {
  choosePlanAuthor,
  defaultWorkMode,
  draftPlan,
  type BoardActivity,
  type BoardPhase,
  type BoardStatus,
  type BoardTask,
  type TeamMember,
  type WorkMode,
} from './model';

export interface TeamInput {
  agentId: string;
  mode?: WorkMode;
}

export interface CreateTaskInput {
  projectId: string;
  team?: TeamInput[];
  workflowId?: string;
}

@Injectable()
export class BoardService implements OnModuleInit, OnModuleDestroy {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: StoreService,
    private readonly runs: RunsService,
    private readonly projects: ProjectsService,
  ) {}

  /** Если сервер погас посреди хода, имитация продолжается с той же фазы. */
  onModuleInit(): void {
    for (const task of this.store.read().tasks) {
      this.resume(task.id, task.phase);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  list(): BoardTask[] {
    return this.store.read().tasks;
  }

  get(id: string): BoardTask {
    return this.must(id);
  }

  create(
    title: string,
    description: string,
    input: CreateTaskInput,
  ): BoardTask {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new BadRequestException('Сначала напишите название задачи.');
    }
    if (cleanTitle.length > 120) {
      throw new BadRequestException('Название короче 120 символов.');
    }
    const cleanDescription = description.trim();
    if (cleanDescription.length > 4000) {
      throw new BadRequestException('Описание короче 4000 символов.');
    }
    const projectId = input.projectId?.trim() ?? '';
    if (!projectId) {
      throw new BadRequestException(
        'Выберите проект или workspace для задачи.',
      );
    }
    const state = this.store.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new BadRequestException('Выбранный проект не найден на сервере.');
    }
    const workflowId = input.workflowId?.trim() ?? '';
    const manualTeam = input.team ?? [];
    const hasWorkflow = workflowId.length > 0;
    const hasTeam = manualTeam.length > 0;
    if (hasWorkflow && hasTeam) {
      throw new BadRequestException(
        'Нельзя одновременно выбрать процесс и отдельных агентов.',
      );
    }
    if (!hasWorkflow && !hasTeam) {
      throw new BadRequestException(
        'Добавьте агентов или выберите процесс для задачи.',
      );
    }
    let members: TeamMember[];
    let workflowName: string | null = null;
    let storedWorkflowId: string | null = null;
    if (hasWorkflow) {
      const workflow = state.workflows.find((item) => item.id === workflowId);
      if (!workflow) {
        throw new BadRequestException('Выбранный процесс не найден.');
      }
      if (workflow.steps.length === 0) {
        throw new BadRequestException('В выбранном процессе нет шагов.');
      }
      members = this.teamFromWorkflow(workflow.steps, state.agents);
      workflowName = workflow.name;
      storedWorkflowId = workflow.id;
    } else {
      members = this.resolveTeam(manualTeam);
    }
    const now = new Date().toISOString();
    const task: BoardTask = {
      id: randomUUID(),
      title: cleanTitle,
      description: cleanDescription,
      status: 'new',
      projectId: project.id,
      projectLabel: displayName(project),
      workflowId: storedWorkflowId,
      workflowName,
      runId: null,
      team: members,
      phase: 'idle',
      activity: [],
      plan: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.mutate((state) => {
      state.tasks.unshift(task);
    });
    return this.must(task.id);
  }

  /**
   * В работу — только из колонки новых. На проверку задачу кладёт сама
   * имитация, когда порядок плана (если он есть) уже пройден.
   */
  move(id: string, status: BoardStatus): BoardTask {
    if (status === 'review') {
      throw new BadRequestException(
        'На проверку задача попадает сама, когда работа закончена. Этот шаг нельзя перескочить.',
      );
    }
    if (status === 'completed') {
      throw new BadRequestException(
        'Завершить задачу можно на экране проверки.',
      );
    }
    if (status === 'new') {
      throw new BadRequestException('Вернуть задачу в новые уже нельзя.');
    }
    const current = this.must(id);
    if (current.status !== 'new' || current.phase !== 'idle') {
      throw new BadRequestException('В работу уходит только новая задача.');
    }
    const runId = this.startRunForTask(current);
    const agents = this.store.read().agents;
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return;
      task.status = 'in_progress';
      task.phase = 'working';
      task.runId = runId;
      task.activity = task.team.map((member) =>
        pickup(
          member,
          agents.find((agent) => agent.id === member.agentId),
        ),
      );
      task.updatedAt = now;
    });
    this.schedule(id, () => this.finishPickup(id));
    return this.must(id);
  }

  /** Правка плана, пока его не отдали в сборку. */
  updatePlan(id: string, text: string): BoardTask {
    const next = cleanPlanText(text);
    const current = this.must(id);
    if (current.phase !== 'plan' || !current.plan?.editable) {
      throw new BadRequestException(
        'План сейчас нельзя править: его ещё нет или он уже ушёл в сборку.',
      );
    }
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task?.plan) return;
      task.plan.text = next;
      task.plan.updatedAt = now;
      task.updatedAt = now;
    });
    return this.must(id);
  }

  /** Задача на проверке принята: уходит с доски в завершённые. */
  completeReview(id: string): BoardTask {
    const current = this.must(id);
    if (current.status !== 'review') {
      throw new BadRequestException('Завершить можно только задачу на проверке.');
    }
    this.stopLinkedRun(current.runId);
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return;
      task.status = 'completed';
      task.phase = 'done';
      task.updatedAt = now;
    });
    return this.must(id);
  }

  /** Дополнение от владельца и снова в работу: план и ход команды начинаются заново. */
  reopenFromReview(id: string, note: string): BoardTask {
    const trimmed = note.trim();
    if (!trimmed) {
      throw new BadRequestException('Напишите, что добавить к задаче.');
    }
    if (trimmed.length > 4000) {
      throw new BadRequestException('Дополнение короче 4000 символов.');
    }
    const current = this.must(id);
    if (current.status !== 'review') {
      throw new BadRequestException(
        'Вернуть в работу можно только задачу на проверке.',
      );
    }
    this.stopLinkedRun(current.runId);
    const stamp = new Date().toISOString();
    const block = `\n\n---\nДополнение (${stamp.slice(0, 10)}):\n${trimmed}`;
    const agents = this.store.read().agents;
    let runId: string | null = null;
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return;
      task.description = task.description.trim()
        ? `${task.description.trim()}${block}`
        : trimmed;
      task.status = 'in_progress';
      task.phase = 'working';
      task.plan = null;
      task.activity = task.team.map((member) =>
        pickup(
          member,
          agents.find((agent) => agent.id === member.agentId),
        ),
      );
      task.updatedAt = stamp;
    });
    const refreshed = this.must(id);
    runId = this.startRunForTask(refreshed);
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return;
      task.runId = runId;
      task.updatedAt = new Date().toISOString();
    });
    this.schedule(id, () => this.finishPickup(id));
    return this.must(id);
  }

  /** Ответ на вопрос агента в связанном запуске, пока задача на проверке. */
  answerFromReview(
    id: string,
    text: string,
  ): { task: BoardTask; run: ReturnType<RunsService['get']> } {
    const task = this.must(id);
    if (task.status !== 'review') {
      throw new BadRequestException(
        'Ответить можно только по задаче на проверке.',
      );
    }
    if (!task.runId) {
      throw new BadRequestException('У задачи нет запуска для ответа.');
    }
    const run = this.runs.answer(task.runId, text);
    return { task: this.must(id), run };
  }

  /** Отдаёт план в сборку. Из правки сразу на проверку перейти нельзя. */
  handToBuild(id: string, text?: string): BoardTask {
    const current = this.must(id);
    if (current.phase !== 'plan' || !current.plan) {
      throw new BadRequestException(
        'Сначала нужен план. Сборку раньше плана запускать нельзя.',
      );
    }
    const next = cleanPlanText(text ?? current.plan.text);
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task?.plan) return;
      task.plan.text = next;
      task.plan.editable = false;
      task.plan.updatedAt = now;
      task.phase = 'build';
      task.status = 'in_progress';
      task.activity = markBuilding(
        task.activity,
        task.plan.authorAgentId,
        state.agents,
      );
      task.updatedAt = now;
    });
    this.schedule(id, () => this.finishBuild(id));
    return this.must(id);
  }

  /** Стартует оркестратор с projectId задачи доски (папка или workspace). */
  private startRunForTask(task: BoardTask): string {
    const projectId = task.projectId?.trim() ?? '';
    if (!projectId) {
      throw new BadRequestException(
        'У задачи не указан проект или workspace. Перевести её в работу нельзя.',
      );
    }
    try {
      this.projects.snapshotForRun(projectId, null, null);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Проект задачи не найден на сервере. Выберите другой в разделе «Проект».',
      );
    }
    const text = task.description.trim()
      ? `${task.title}\n\n${task.description}`
      : task.title;
    const workflowId = task.workflowId ?? 'workflow_supervised';
    const roleIds = task.workflowId
      ? undefined
      : task.team.map((member) => member.agentId);
    try {
      const run = this.runs.start(workflowId, text, {
        projectId,
        roleIds,
      });
      return run.id;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new BadRequestException(
          'Сейчас уже идёт другой запуск. Остановите его или дождитесь завершения, затем снова переведите задачу в работу.',
        );
      }
      throw error;
    }
  }

  private teamFromWorkflow(
    steps: WorkflowStep[],
    agents: Agent[],
  ): TeamMember[] {
    const ordered = orderSteps(steps);
    const seen = new Set<string>();
    const members: TeamMember[] = [];
    for (const step of ordered) {
      if (seen.has(step.agentId)) continue;
      const agent = agents.find((item) => item.id === step.agentId);
      if (!agent) {
        throw new BadRequestException(
          'Процесс ссылается на удалённого агента.',
        );
      }
      seen.add(step.agentId);
      members.push({
        agentId: agent.id,
        mode: workModeFromStep(step.mode),
      });
    }
    if (members.length === 0) {
      throw new BadRequestException(
        'Из процесса не получилось собрать команду.',
      );
    }
    return members;
  }

  private resolveTeam(team: TeamInput[]): TeamMember[] {
    if (team.length === 0) {
      throw new BadRequestException('Выберите хотя бы одного агента.');
    }
    const agents = this.store.read().agents;
    const seen = new Set<string>();
    const members: TeamMember[] = [];
    for (const item of team) {
      const id = item.agentId.trim();
      if (!id || seen.has(id)) continue;
      const agent = agents.find((candidate) => candidate.id === id);
      if (!agent) {
        throw new BadRequestException('В команде есть неизвестный агент.');
      }
      seen.add(id);
      members.push({
        agentId: agent.id,
        mode: item.mode ?? defaultWorkMode(agent.kind),
      });
    }
    if (members.length === 0) {
      throw new BadRequestException('Выберите хотя бы одного агента.');
    }
    return members;
  }

  private finishPickup(taskId: string): void {
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task || task.phase !== 'working') return;
      const author = choosePlanAuthor(task.team, state.agents);
      const wantsPlan = task.team.some((member) => member.mode === 'plan');
      if (wantsPlan) {
        const authorId =
          author?.id ??
          task.team.find((member) => member.mode === 'plan')?.agentId ??
          '';
        const authorName =
          author?.name ??
          task.activity.find((item) => item.agentId === authorId)?.agentName ??
          'Агент';
        task.plan = {
          text: draftPlan(task.title, task.description, authorName),
          authorAgentId: authorId,
          authorName,
          editable: true,
          updatedAt: now,
        };
        task.phase = 'plan';
        task.activity = task.activity.map((item) => {
          if (item.mode === 'ask') {
            return { ...item, state: 'done', note: askNote(item.agentName) };
          }
          if (item.mode === 'plan') {
            return item.agentId === authorId
              ? {
                  ...item,
                  state: 'done',
                  note: 'Составил план. Его можно открыть и поправить до сборки.',
                }
              : {
                  ...item,
                  state: 'done',
                  note: `План ведёт ${authorName}. Свой документ не подменяю.`,
                };
          }
          return {
            ...item,
            state: 'waiting',
            note: 'Ждёт, пока план отдадут в сборку.',
          };
        });
      } else {
        task.activity = task.activity.map((item) => ({
          ...item,
          state: 'done',
          note:
            item.mode === 'ask'
              ? askNote(item.agentName)
              : 'Сделал свою часть без плана: режим вопроса и агента план не требует.',
        }));
        task.phase = 'done';
        task.status = 'review';
      }
      task.updatedAt = now;
    });
  }

  private finishBuild(taskId: string): void {
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task || task.phase !== 'build') return;
      task.activity = task.activity.map((item) => {
        if (item.state !== 'working') return item;
        const agent = state.agents.find(
          (candidate) => candidate.id === item.agentId,
        );
        if (agent?.kind === 'reviewer') {
          return { ...item, state: 'done', note: 'Сверил результат с планом.' };
        }
        if (item.agentId === task.plan?.authorAgentId && item.mode === 'plan') {
          return { ...item, state: 'done', note: 'Сборка по плану завершена.' };
        }
        return { ...item, state: 'done', note: 'Собрал по переданному плану.' };
      });
      task.phase = 'done';
      task.status = 'review';
      task.updatedAt = now;
      if (task.plan) task.plan.editable = false;
    });
  }

  private resume(taskId: string, phase: BoardPhase): void {
    if (phase === 'working')
      this.schedule(taskId, () => this.finishPickup(taskId));
    if (phase === 'build')
      this.schedule(taskId, () => this.finishBuild(taskId));
  }

  /** Нулевая задержка идёт микрозадачей, чтобы ответ «команда взяла задачу» успел уйти. */
  private schedule(taskId: string, fn: () => void): void {
    const previous = this.timers.get(taskId);
    if (previous) clearTimeout(previous);
    const delay = readDelayMs();
    if (delay <= 0) {
      this.timers.delete(taskId);
      queueMicrotask(() => fn());
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(taskId);
      fn();
    }, delay);
    this.timers.set(taskId, timer);
  }

  private stopLinkedRun(runId: string | null): void {
    if (!runId) return;
    try {
      const run = this.runs.get(runId);
      if (
        run.status === 'running' ||
        run.status === 'waiting_approval' ||
        run.status === 'waiting_user' ||
        run.status === 'waiting_plan'
      ) {
        this.runs.stop(runId);
      }
    } catch {
      // Запуск уже удалён или недоступен — доску это не блокирует.
    }
  }

  private must(id: string): BoardTask {
    const task = this.store.read().tasks.find((item) => item.id === id);
    if (!task) throw new NotFoundException('Задача не найдена.');
    return task;
  }
}

function cleanPlanText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new BadRequestException('План не может быть пустым.');
  if (trimmed.length > 20_000) {
    throw new BadRequestException('План короче 20000 символов.');
  }
  return trimmed;
}

function pickup(member: TeamMember, agent: Agent | undefined): BoardActivity {
  const cursor = agent?.harness === 'cursor';
  return {
    agentId: member.agentId,
    agentName: agent?.name ?? 'Агент',
    mode: member.mode,
    state: 'working',
    note: cursor
      ? 'Взял задачу. Токен на вызов не тратится, ход имитируется.'
      : 'Взял задачу.',
  };
}

function workModeFromStep(mode: StepMode): WorkMode {
  if (mode === 'question' || mode === 'ask') return 'ask';
  if (mode === 'plan') return 'plan';
  return 'agent';
}

function askNote(name: string): string {
  return `${name} ответил в режиме вопроса, без плана и без правок.`;
}

function markBuilding(
  activity: BoardActivity[],
  authorId: string,
  agents: Agent[],
): BoardActivity[] {
  const builders = activity.filter((item) => item.mode === 'agent');
  if (builders.length === 0) {
    return activity.map((item) =>
      item.agentId === authorId
        ? {
            ...item,
            state: 'working',
            note: 'Ведёт сборку по этому плану. Сеть не вызывается.',
          }
        : item,
    );
  }
  return activity.map((item) => {
    if (item.mode !== 'agent') return item;
    const agent = agents.find((candidate) => candidate.id === item.agentId);
    return {
      ...item,
      state: 'working',
      note:
        agent?.kind === 'reviewer'
          ? 'Проверяет сборку по плану.'
          : 'Собирает по плану. Сеть не вызывается.',
    };
  });
}
