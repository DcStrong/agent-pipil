/**
 * Доска задач. Команда стартует при переносе в in_progress.
 * Ход всегда имитация: клиент Cursor здесь не создаётся и сеть не вызывается,
 * даже если у агента среда Cursor и токен уже сохранён.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Agent } from '../domain';
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

@Injectable()
export class BoardService implements OnModuleInit, OnModuleDestroy {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly store: StoreService) {}

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

  create(title: string, description: string, team: TeamInput[]): BoardTask {
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
    const members = this.resolveTeam(team);
    const now = new Date().toISOString();
    const task: BoardTask = {
      id: randomUUID(),
      title: cleanTitle,
      description: cleanDescription,
      status: 'new',
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
    if (status === 'new') {
      throw new BadRequestException('Вернуть задачу в новые уже нельзя.');
    }
    const current = this.must(id);
    if (current.status !== 'new' || current.phase !== 'idle') {
      throw new BadRequestException('В работу уходит только новая задача.');
    }
    const agents = this.store.read().agents;
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.id === id);
      if (!task) return;
      task.status = 'in_progress';
      task.phase = 'working';
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
