import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import type { Run, RunStageSnapshot } from '../domain';
import { PipelineRunner, readDelayMs } from '../pipeline/pipeline-runner';
import { StoreService } from '../store/store.service';

export type StreamMessage = { type: 'run'; run: Run } | { type: 'idle' };

@Injectable()
export class RunsService {
  private readonly updates = new Subject<StreamMessage>();

  constructor(
    private readonly store: StoreService,
    private readonly runner: PipelineRunner,
  ) {}

  list(): Run[] {
    return this.store.read().runs;
  }

  get(id: string): Run {
    const run = this.store.getRun(id);
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  watch(): Observable<StreamMessage> {
    return new Observable((subscriber) => {
      const current = this.store.relevantRun();
      subscriber.next(
        current ? { type: 'run', run: current } : { type: 'idle' },
      );
      const subscription = this.updates.subscribe((event) => {
        subscriber.next(event);
      });
      return () => subscription.unsubscribe();
    });
  }

  start(task: string): Run {
    const trimmed = task.trim();
    if (!trimmed) {
      throw new BadRequestException('Write a task before sending it.');
    }
    if (trimmed.length > 4000) {
      throw new BadRequestException('Keep the task under 4000 characters.');
    }
    if (this.store.hasRunningRun()) {
      throw new ConflictException(
        'A task is already moving through the pipeline.',
      );
    }
    const stages = this.snapshot();
    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(),
      task: trimmed,
      status: 'running',
      stageIndex: null,
      ownerRoleId: null,
      ownerName: null,
      stages,
      work: [],
      events: [
        {
          id: randomUUID(),
          at: now,
          kind: 'started',
          message: 'The task entered the pipeline.',
          stageIndex: null,
          roleId: null,
        },
      ],
      finalResult: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.upsertRun(run);
    void this.runner.execute(
      run,
      (snapshot) => {
        this.store.upsertRun(snapshot);
        this.updates.next({ type: 'run', run: snapshot });
      },
      readDelayMs(),
    );
    return this.store.getRun(run.id) ?? run;
  }

  private snapshot(): RunStageSnapshot[] {
    const state = this.store.read();
    if (state.stages.length === 0) {
      throw new BadRequestException('Add at least one stage to the pipeline.');
    }
    const shared = state.skills.filter((skill) => skill.scope === 'shared');
    return state.stages.map((stage) => {
      const role = state.roles.find((item) => item.id === stage.roleId);
      if (!role) {
        throw new BadRequestException('The pipeline points at a missing role.');
      }
      const own = state.skills.filter(
        (skill) => skill.scope === 'role' && skill.roleId === role.id,
      );
      return {
        stageId: stage.id,
        roleId: role.id,
        roleName: role.name,
        systemPrompt: role.systemPrompt,
        handoffInstruction: stage.handoffInstruction,
        skills: [...shared, ...own].map((skill) => ({
          name: skill.name,
          instructions: skill.instructions,
          scope: skill.scope,
        })),
      };
    });
  }
}
