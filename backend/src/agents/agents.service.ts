import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Agent, AgentKind, Harness } from '../domain';
import { StoreService } from '../store/store.service';

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new BadRequestException('Агенту нужно имя.');
  if (name.length > 60)
    throw new BadRequestException('Имя агента короче 60 символов.');
  return name;
}

function cleanInstructions(value: string): string {
  const instructions = value.trim();
  if (!instructions) throw new BadRequestException('Агенту нужны инструкции.');
  if (instructions.length > 8000) {
    throw new BadRequestException('Инструкции короче 8000 символов.');
  }
  return instructions;
}

@Injectable()
export class AgentsService {
  constructor(private readonly store: StoreService) {}

  list(): Agent[] {
    return this.store.read().agents;
  }

  get(id: string): Agent {
    const agent = this.store.read().agents.find((item) => item.id === id);
    if (!agent) throw new NotFoundException('Агент не найден.');
    return agent;
  }

  create(
    name: string,
    kind: AgentKind,
    instructions: string,
    harness: Harness,
  ): Agent {
    const agent: Agent = {
      id: randomUUID(),
      name: cleanName(name),
      kind,
      instructions: cleanInstructions(instructions),
      harness,
    };
    this.store.mutate((state) => {
      state.agents.push(agent);
    });
    return agent;
  }

  update(
    id: string,
    name: string,
    kind: AgentKind,
    instructions: string,
    harness: Harness,
  ): Agent {
    if (!this.store.read().agents.some((agent) => agent.id === id)) {
      throw new NotFoundException('Агент не найден.');
    }
    const next: Agent = {
      id,
      name: cleanName(name),
      kind,
      instructions: cleanInstructions(instructions),
      harness,
    };
    this.store.mutate((state) => {
      state.agents = state.agents.map((agent) =>
        agent.id === id ? next : agent,
      );
    });
    return next;
  }

  remove(id: string): void {
    const state = this.store.read();
    if (!state.agents.some((agent) => agent.id === id)) {
      throw new NotFoundException('Агент не найден.');
    }
    const used = state.workflows.some((workflow) =>
      workflow.steps.some((step) => step.agentId === id),
    );
    if (used) {
      throw new BadRequestException(
        'Сначала уберите агента из шагов процесса.',
      );
    }
    this.store.mutate((draft) => {
      draft.agents = draft.agents.filter((agent) => agent.id !== id);
      draft.skills = draft.skills.filter((skill) => skill.agentId !== id);
    });
  }
}
