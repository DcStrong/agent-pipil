import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Skill, SkillScope } from '../domain';
import { StoreService } from '../store/store.service';

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new BadRequestException('Навыку нужно имя.');
  if (name.length > 80)
    throw new BadRequestException('Имя навыка короче 80 символов.');
  return name;
}

function cleanInstructions(value: string): string {
  const instructions = value.trim();
  if (!instructions) throw new BadRequestException('Навыку нужны инструкции.');
  if (instructions.length > 4000) {
    throw new BadRequestException('Инструкции навыка короче 4000 символов.');
  }
  return instructions;
}

@Injectable()
export class SkillsService {
  constructor(private readonly store: StoreService) {}

  list(): Skill[] {
    return this.store.read().skills;
  }

  create(
    name: string,
    instructions: string,
    scope: SkillScope,
    agentId: string | null,
  ): Skill {
    const skill = this.build(randomUUID(), name, instructions, scope, agentId);
    this.store.mutate((state) => {
      state.skills.push(skill);
    });
    return skill;
  }

  update(
    id: string,
    name: string,
    instructions: string,
    scope: SkillScope,
    agentId: string | null,
  ): Skill {
    if (!this.store.read().skills.some((skill) => skill.id === id)) {
      throw new NotFoundException('Навык не найден.');
    }
    const skill = this.build(id, name, instructions, scope, agentId);
    this.store.mutate((state) => {
      state.skills = state.skills.map((item) =>
        item.id === id ? skill : item,
      );
    });
    return skill;
  }

  remove(id: string): void {
    if (!this.store.read().skills.some((skill) => skill.id === id)) {
      throw new NotFoundException('Навык не найден.');
    }
    this.store.mutate((state) => {
      state.skills = state.skills.filter((skill) => skill.id !== id);
    });
  }

  private build(
    id: string,
    name: string,
    instructions: string,
    scope: SkillScope,
    agentId: string | null,
  ): Skill {
    if (scope !== 'shared' && scope !== 'agent') {
      throw new BadRequestException(
        'Навык либо общий, либо принадлежит агенту.',
      );
    }
    if (scope === 'shared') {
      return {
        id,
        name: cleanName(name),
        instructions: cleanInstructions(instructions),
        scope,
        agentId: null,
      };
    }
    if (!agentId)
      throw new BadRequestException('Выберите агента для этого навыка.');
    const exists = this.store
      .read()
      .agents.some((agent) => agent.id === agentId);
    if (!exists) throw new BadRequestException('Такого агента нет.');
    return {
      id,
      name: cleanName(name),
      instructions: cleanInstructions(instructions),
      scope,
      agentId,
    };
  }
}
