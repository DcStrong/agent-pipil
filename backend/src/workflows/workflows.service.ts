import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StepMode, Workflow, WorkflowStep } from '../domain';
import { hasCycle, resolvedNext } from '../runtime/step-graph';
import { StoreService } from '../store/store.service';

export interface StepInput {
  id?: string;
  agentId: string;
  title: string;
  mode: StepMode;
  handoff: string;
  nextIds?: string[];
}

@Injectable()
export class WorkflowsService {
  constructor(private readonly store: StoreService) {}

  list(): Workflow[] {
    return this.store.read().workflows;
  }

  get(id: string): Workflow {
    const workflow = this.store.read().workflows.find((item) => item.id === id);
    if (!workflow) throw new NotFoundException('Процесс не найден.');
    return workflow;
  }

  /** Собирает процесс из агентов планировщика, сборщика и ревьюера. */
  create(name: string): Workflow {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Процессу нужно имя.');
    if (trimmed.length > 80)
      throw new BadRequestException('Имя процесса короче 80 символов.');
    const agents = this.store.read().agents;
    const planner =
      agents.find((agent) => agent.kind === 'planner') ?? agents[0];
    const builder =
      agents.find((agent) => agent.kind === 'builder') ?? agents[1] ?? planner;
    const reviewer =
      agents.find((agent) => agent.kind === 'reviewer') ?? agents[2] ?? planner;
    if (!planner || !builder || !reviewer) {
      throw new BadRequestException('Сначала добавьте хотя бы одного агента.');
    }
    const workflow: Workflow = {
      id: randomUUID(),
      name: trimmed,
      description:
        'План и сборка идут сами. Проверка ждёт подтверждения владельца.',
      steps: [
        {
          id: randomUUID(),
          agentId: planner.id,
          title: 'План',
          mode: 'automatic',
          handoff: 'Передай проблему и критерии готовности.',
          nextIds: [],
        },
        {
          id: randomUUID(),
          agentId: builder.id,
          title: 'Сборка',
          mode: 'automatic',
          handoff: 'Передай изменения и способ проверки.',
          nextIds: [],
        },
        {
          id: randomUUID(),
          agentId: reviewer.id,
          title: 'Проверка',
          mode: 'approval',
          handoff: '',
          nextIds: [],
        },
      ],
    };
    this.store.mutate((state) => {
      state.workflows.push(workflow);
    });
    return workflow;
  }

  replace(
    id: string,
    name: string,
    description: string,
    steps: StepInput[],
  ): Workflow {
    if (!this.store.read().workflows.some((workflow) => workflow.id === id)) {
      throw new NotFoundException('Процесс не найден.');
    }
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Процессу нужно имя.');
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new BadRequestException('В процессе нужен хотя бы один шаг.');
    }
    const agents = this.store.read().agents;
    const used = new Set<string>();
    const nextSteps: WorkflowStep[] = steps.map((step) => {
      if (
        !step ||
        typeof step.agentId !== 'string' ||
        !agents.some((agent) => agent.id === step.agentId)
      ) {
        throw new BadRequestException(
          'У каждого шага должен быть существующий агент.',
        );
      }
      if (typeof step.title !== 'string' || !step.title.trim()) {
        throw new BadRequestException('У каждого шага должно быть название.');
      }
      if (
        step.mode !== 'automatic' &&
        step.mode !== 'approval' &&
        step.mode !== 'question' &&
        step.mode !== 'ask' &&
        step.mode !== 'plan' &&
        step.mode !== 'build' &&
        step.mode !== 'review'
      ) {
        throw new BadRequestException(
          'Режим шага: automatic, approval, question, ask, plan, build или review.',
        );
      }
      if (typeof step.handoff !== 'string') {
        throw new BadRequestException(
          'У каждого шага должна быть заметка передачи.',
        );
      }
      const handoff = step.handoff.trim();
      let stepId = typeof step.id === 'string' ? step.id.trim() : '';
      if (!stepId || used.has(stepId)) stepId = randomUUID();
      used.add(stepId);
      const nextIds = Array.isArray(step.nextIds)
        ? step.nextIds.filter((id): id is string => typeof id === 'string')
        : [];
      return {
        id: stepId,
        agentId: step.agentId,
        title: step.title.trim(),
        mode: step.mode,
        handoff,
        nextIds,
      };
    });
    const known = new Set(nextSteps.map((step) => step.id));
    for (const step of nextSteps) {
      step.nextIds = [...new Set(step.nextIds.filter((id) => id !== step.id))];
      if (step.nextIds.some((id) => !known.has(id))) {
        throw new BadRequestException('Связь ведёт на неизвестный шаг.');
      }
    }
    if (hasCycle(nextSteps)) {
      throw new BadRequestException('Связь замыкает конвейер.');
    }
    const outgoing = resolvedNext(nextSteps);
    for (const step of nextSteps) {
      if (
        (outgoing.get(step.id) ?? []).length > 0 &&
        step.handoff.length === 0
      ) {
        throw new BadRequestException(
          'Напишите передачу для каждого шага, у которого есть следующий.',
        );
      }
    }
    const workflow: Workflow = {
      id,
      name: trimmed,
      description: description.trim(),
      steps: nextSteps,
    };
    this.store.mutate((state) => {
      state.workflows = state.workflows.map((item) =>
        item.id === id ? workflow : item,
      );
    });
    return workflow;
  }

  remove(id: string): void {
    if (!this.store.read().workflows.some((workflow) => workflow.id === id)) {
      throw new NotFoundException('Процесс не найден.');
    }
    this.store.mutate((state) => {
      state.workflows = state.workflows.filter(
        (workflow) => workflow.id !== id,
      );
    });
  }
}
