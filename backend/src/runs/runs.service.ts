import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import type { Run, RunStep } from '../domain';
import { CursorClient } from '../runtime/cursor-client';
import { Orchestrator, readDelayMs } from '../runtime/orchestrator';
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

  start(workflowId: string, task: string): Run {
    const trimmed = task.trim();
    if (!trimmed) throw new BadRequestException('Сначала напишите задачу.');
    if (trimmed.length > 4000)
      throw new BadRequestException('Задача короче 4000 символов.');
    if (this.store.hasActiveRun()) {
      throw new ConflictException('Сейчас уже идёт один запуск.');
    }
    const steps = this.snapshot(workflowId);
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
    if (current.status !== 'waiting_approval') {
      throw new BadRequestException('Этот запуск не ждёт подтверждения.');
    }
    const accepted = this.orchestrator.decide(id, approved);
    if (!accepted) {
      throw new BadRequestException('Подтверждение уже некому передать.');
    }
    return this.get(id);
  }

  private snapshot(workflowId: string): RunStep[] {
    const state = this.store.read();
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new NotFoundException('Процесс не найден.');
    if (workflow.steps.length === 0) {
      throw new BadRequestException('В процессе нет шагов.');
    }
    const shared = state.skills.filter((skill) => skill.scope === 'shared');
    return workflow.steps.map((step) => {
      const agent = state.agents.find((item) => item.id === step.agentId);
      if (!agent)
        throw new BadRequestException('Шаг ссылается на удалённого агента.');
      const own = state.skills.filter(
        (skill) => skill.scope === 'agent' && skill.agentId === agent.id,
      );
      return {
        stepId: step.id,
        agentId: agent.id,
        agentName: agent.name,
        title: step.title,
        mode: step.mode,
        handoff: step.handoff,
        instructions: agent.instructions,
        harness: agent.harness,
        skills: [...shared, ...own].map((skill) => ({
          name: skill.name,
          instructions: skill.instructions,
          scope: skill.scope,
        })),
      };
    });
  }
}
