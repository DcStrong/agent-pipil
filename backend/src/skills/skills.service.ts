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
  if (!name) throw new BadRequestException('A skill needs a name.');
  if (name.length > 80) {
    throw new BadRequestException('Keep the skill name under 80 characters.');
  }
  return name;
}

function cleanInstructions(value: string): string {
  const instructions = value.trim();
  if (!instructions) {
    throw new BadRequestException('A skill needs instructions.');
  }
  if (instructions.length > 4000) {
    throw new BadRequestException(
      'Keep the skill instructions under 4000 characters.',
    );
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
    roleId: string | null,
  ): Skill {
    const skill = this.build(randomUUID(), name, instructions, scope, roleId);
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
    roleId: string | null,
  ): Skill {
    if (!this.store.read().skills.some((skill) => skill.id === id)) {
      throw new NotFoundException('Skill not found.');
    }
    const skill = this.build(id, name, instructions, scope, roleId);
    this.store.mutate((state) => {
      state.skills = state.skills.map((item) =>
        item.id === id ? skill : item,
      );
    });
    return skill;
  }

  remove(id: string): void {
    if (!this.store.read().skills.some((skill) => skill.id === id)) {
      throw new NotFoundException('Skill not found.');
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
    roleId: string | null,
  ): Skill {
    if (scope !== 'shared' && scope !== 'role') {
      throw new BadRequestException(
        'A skill is either shared or role-specific.',
      );
    }
    if (scope === 'shared') {
      return {
        id,
        name: cleanName(name),
        instructions: cleanInstructions(instructions),
        scope,
        roleId: null,
      };
    }
    if (!roleId) {
      throw new BadRequestException('Choose a role for this skill.');
    }
    const roleExists = this.store
      .read()
      .roles.some((role) => role.id === roleId);
    if (!roleExists) throw new BadRequestException('That role does not exist.');
    return {
      id,
      name: cleanName(name),
      instructions: cleanInstructions(instructions),
      scope,
      roleId,
    };
  }
}
