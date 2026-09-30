import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StepMode, Workflow, WorkflowStep } from '../domain';
import { StoreService } from '../store/store.service';

export interface StepInput {
  id?: string;
  agentId: string;
  title: string;
  mode: StepMode;
  handoff: string;
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
        },
        {
          id: randomUUID(),
          agentId: builder.id,
          title: 'Сборка',
          mode: 'automatic',
          handoff: 'Передай изменения и способ проверки.',
        },
        {
          id: randomUUID(),
          agentId: reviewer.id,
          title: 'Проверка',
          mode: 'approval',
          handoff: '',
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
    const nextSteps: WorkflowStep[] = steps.map((step, index) => {
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
      if (step.mode !== 'automatic' && step.mode !== 'approval') {
        throw new BadRequestException('Режим шага: automatic или approval.');
      }
      if (typeof step.handoff !== 'string') {
        throw new BadRequestException(
          'У каждого шага должна быть заметка передачи.',
        );
      }
      const handoff = step.handoff.trim();
      const isLast = index === steps.length - 1;
      if (!isLast && handoff.length === 0) {
        throw new BadRequestException(
          'Напишите передачу для каждого шага, кроме последнего.',
        );
      }
      let stepId = typeof step.id === 'string' ? step.id.trim() : '';
      if (!stepId || used.has(stepId)) stepId = randomUUID();
      used.add(stepId);
      return {
        id: stepId,
        agentId: step.agentId,
        title: step.title.trim(),
        mode: step.mode,
        handoff,
      };
    });
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
