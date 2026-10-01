import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import type { AgentKind, Run, RunStep, StepMode, TaskPlan } from '../domain';
import { checklistItems } from '../runtime/task-order';
import { roleOrder } from '../domain';
import { orderSteps } from '../runtime/step-graph';
import { CursorClient } from '../runtime/cursor-client';
import { Orchestrator, readDelayMs } from '../runtime/orchestrator';
import { inspectProject } from '../runtime/project-folder';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';

export type StreamMessage = { type: 'run'; run: Run } | { type: 'idle' };

@Injectable()
export class RunsService {
  private readonly updates = new Subject<StreamMessage>();
  private readonly orchestrator = new Orchestrator();
  private readonly cursor = new CursorClient();

  constructor(
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  list(): Run[] {
    return this.store.read().runs;
  }

  get(id: string): Run {
    const run = this.store.getRun(id);
    if (!run) throw new NotFoundException('Запуск не найден.');
    return run;
  }

  watch(): Observable<StreamMessage> {
    return new Observable((subscriber) => {
      const current = this.store.relevantRun();
      subscriber.next(
        current ? { type: 'run', run: current } : { type: 'idle' },
      );
      const subscription = this.updates.subscribe((event) =>
        subscriber.next(event),
      );
      return () => subscription.unsubscribe();
    });
  }

  start(
    workflowId: string,
    task: string,
    options?: {
      roleIds?: string[];
      projectPath?: string | null;
      mapPath?: string | null;
      deepThinking?: boolean;
    },
  ): Run {
    const trimmed = task.trim();
    if (!trimmed) throw new BadRequestException('Сначала напишите задачу.');
    if (trimmed.length > 4000)
      throw new BadRequestException('Задача короче 4000 символов.');
    if (this.store.hasActiveRun()) {
      throw new ConflictException('Сейчас уже идёт один запуск.');
    }
    const steps = options?.roleIds
      ? this.snapshotRoles(options.roleIds)
      : this.snapshot(workflowId);
    const workflow = this.store
      .read()
      .workflows.find((item) => item.id === workflowId);
    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(),
      workflowId,
      workflowName: workflow?.name ?? 'Процесс',
      task: trimmed,
      status: 'running',
      stepIndex: null,
      steps,
      work: [],
      events: [
        {
          id: randomUUID(),
          at: now,
          kind: 'progress',
          message: 'Задача вошла в процесс.',
          stepIndex: null,
        },
      ],
      finalResult: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      project: inspectProject(
        options?.projectPath ?? null,
        options?.mapPath ?? null,
      ),
      developerShape: 'none',
      pendingQuestion: null,
      mapWritten: false,
      mapNote: null,
      deepThinking: options?.deepThinking === true,
      note: null,
      plan: null,
      buildText: null,
      reviewText: null,
      taskFolder: null,
      archive: null,
    };
    this.store.upsertRun(run);
    const cursorConnected = this.settings.hasToken();
    const live = this.cursor.liveEnabled();
    void this.orchestrator
      .execute(
        run,
        (snapshot) => {
          this.store.upsertRun(snapshot);
          this.updates.next({ type: 'run', run: snapshot });
        },
        { delayMs: readDelayMs(), cursorConnected, live },
      )
      .catch(() => undefined);
    return this.store.getRun(run.id) ?? run;
  }

  decide(id: string, approved: boolean): Run {
    const current = this.get(id);
    if (!approved && current.status === 'waiting_user') {
      return this.haltOpen(id, 'Владелец отклонил вопрос.');
    }
    if (current.status !== 'waiting_approval') {
      throw new BadRequestException('Этот запуск не ждёт подтверждения.');
    }
    const accepted = this.orchestrator.decide(id, approved);
    if (!accepted) {
      throw new BadRequestException('Подтверждение уже некому передать.');
    }
    const live = this.orchestrator.peek(id);
    if (live) this.publishLive(live);
    return this.get(id);
  }

  /** Заканчивает открытый запуск, чтобы холст снова можно было править. */
  stop(id: string): Run {
    const current = this.get(id);
    if (!this.isOpenStatus(current.status)) {
      throw new BadRequestException('Этот запуск уже закончен.');
    }
    return this.haltOpen(id, 'Запуск остановлен.');
  }

  /** Кладёт поправленный план и отпускает сборку. */
  savePlan(
    id: string,
    raw: {
      why?: unknown;
      changes?: unknown;
      how?: unknown;
      checklist?: unknown;
    },
  ): Run {
    const current = this.get(id);
    if (current.status !== 'waiting_plan') {
      throw new BadRequestException('Этот запуск не ждёт правки плана.');
    }
    const plan: TaskPlan = {
      why: this.planField(raw.why, 'Зачем'),
      changes: this.planField(raw.changes, 'Что меняется'),
      how: this.planField(raw.how, 'Как'),
      checklist: this.planField(raw.checklist, 'Чеклист'),
    };
    if (checklistItems(plan.checklist).length === 0) {
      throw new BadRequestException('В чеклисте нужна хотя бы одна строка.');
    }
    const accepted = this.orchestrator.revise(id, plan);
    if (!accepted) {
      throw new BadRequestException('План уже некому передать.');
    }
    return this.get(id);
  }

  /** Ответ владельца уходит только в диалог роли, которая спросила. */
  answer(id: string, text: string): Run {
    const current = this.get(id);
    if (current.status !== 'waiting_user') {
      throw new BadRequestException('Этот запуск не ждёт ответа.');
    }
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Сначала напишите ответ.');
    if (trimmed.length > 2000) {
      throw new BadRequestException('Ответ короче 2000 символов.');
    }
    const accepted = this.orchestrator.answer(id, trimmed);
    if (!accepted) {
      throw new BadRequestException('Ответ уже некому передать.');
    }
    return this.get(id);
  }

  private haltOpen(id: string, reason: string): Run {
    const live = this.orchestrator.requestHalt(id, reason);
    if (live && (live.status === 'failed' || live.status === 'completed')) {
      this.publishLive(live);
      return this.get(id);
    }
    const again = this.get(id);
    if (!this.isOpenStatus(again.status)) return again;
    const at = new Date().toISOString();
    again.status = 'failed';
    again.error = reason;
    again.pendingQuestion = null;
    again.finishedAt = at;
    again.updatedAt = at;
    again.events.push({
      id: randomUUID(),
      at,
      kind: 'error',
      message: reason,
      stepIndex: again.stepIndex,
    });
    this.store.upsertRun(again);
    this.updates.next({ type: 'run', run: structuredClone(again) });
    return this.get(id);
  }

  private publishLive(run: Run): void {
    const snapshot = structuredClone(run);
    this.store.upsertRun(snapshot);
    this.updates.next({ type: 'run', run: snapshot });
  }

  private isOpenStatus(status: Run['status']): boolean {
    return (
      status === 'running' ||
      status === 'waiting_approval' ||
      status === 'waiting_user' ||
      status === 'waiting_plan'
    );
  }

  private planField(value: unknown, label: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${label} нужно написать текстом.`);
    }
    const trimmed = value.trim();
    if (!trimmed)
      throw new BadRequestException(`${label} не может быть пустым.`);
    if (trimmed.length > 2000) {
      throw new BadRequestException(`${label} короче 2000 символов.`);
    }
    return trimmed;
  }

  private freshStep(
    stepId: string,
    agent: {
      id: string;
      name: string;
      kind: AgentKind;
      instructions: string;
      harness: RunStep['harness'];
    },
    title: string,
    mode: StepMode,
    handoff: string,
  ): RunStep {
    const state = this.store.read();
    const shared = state.skills.filter((skill) => skill.scope === 'shared');
    const own = state.skills.filter(
      (skill) => skill.scope === 'agent' && skill.agentId === agent.id,
    );
    return {
      stepId,
      agentId: agent.id,
      agentName: agent.name,
      title,
      mode,
      handoff,
      instructions: agent.instructions,
      harness: agent.harness,
      skills: [...shared, ...own].map((skill) => ({
        name: skill.name,
        instructions: skill.instructions,
        scope: skill.scope,
      })),
      dialogueId: randomUUID(),
      kind: agent.kind,
      messages: [],
      brief: null,
      question: null,
      mapAddition: null,
    };
  }

  /** Отдельный новый диалог на каждую выбранную роль. */
  private snapshotRoles(roleIds: string[]): RunStep[] {
    const unique = [...new Set(roleIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new BadRequestException('Выберите хотя бы одну роль.');
    }
    const agents = this.store.read().agents;
    const chosen = unique.map((id) => {
      const agent = agents.find((item) => item.id === id);
      if (!agent)
        throw new BadRequestException('Среди ролей есть неизвестная.');
      return agent;
    });
    chosen.sort((left, right) => roleOrder(left.kind) - roleOrder(right.kind));
    return chosen.map((agent) =>
      this.freshStep(
        randomUUID(),
        agent,
        agent.name,
        agent.kind === 'architect' ? 'question' : 'automatic',
        '',
      ),
    );
  }

  private snapshot(workflowId: string): RunStep[] {
    const state = this.store.read();
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new NotFoundException('Процесс не найден.');
    if (workflow.steps.length === 0) {
      throw new BadRequestException('В процессе нет шагов.');
    }
    return orderSteps(workflow.steps).map((step) => {
      const agent = state.agents.find((item) => item.id === step.agentId);
      if (!agent)
        throw new BadRequestException('Шаг ссылается на удалённого агента.');
      return this.freshStep(
        step.id,
        agent,
        step.title,
        step.mode,
        step.handoff,
      );
    });
  }
}
