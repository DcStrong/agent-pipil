import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Role } from '../domain';
import { StoreService } from '../store/store.service';

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new BadRequestException('A role needs a name.');
  if (name.length > 60) {
    throw new BadRequestException('Keep the role name under 60 characters.');
  }
  return name;
}

function cleanPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new BadRequestException('A role needs a system prompt.');
  if (prompt.length > 8000) {
    throw new BadRequestException(
      'Keep the system prompt under 8000 characters.',
    );
  }
  return prompt;
}

@Injectable()
export class RolesService {
  constructor(private readonly store: StoreService) {}

  list(): Role[] {
    return this.store.read().roles;
  }

  create(name: string, systemPrompt: string): Role {
    const role: Role = {
      id: randomUUID(),
      name: cleanName(name),
      systemPrompt: cleanPrompt(systemPrompt),
    };
    this.store.mutate((state) => {
      state.roles.push(role);
    });
    return role;
  }

  update(id: string, name: string, systemPrompt: string): Role {
    const next: Role = {
      id,
      name: cleanName(name),
      systemPrompt: cleanPrompt(systemPrompt),
    };
    const exists = this.store.read().roles.some((role) => role.id === id);
    if (!exists) throw new NotFoundException('Role not found.');
    this.store.mutate((state) => {
      state.roles = state.roles.map((role) => (role.id === id ? next : role));
    });
    return next;
  }

  remove(id: string): void {
    const state = this.store.read();
    if (!state.roles.some((role) => role.id === id)) {
      throw new NotFoundException('Role not found.');
    }
    if (state.stages.some((stage) => stage.roleId === id)) {
      throw new BadRequestException(
        'Remove this role from the pipeline before deleting it.',
      );
    }
    this.store.mutate((draft) => {
      draft.roles = draft.roles.filter((role) => role.id !== id);
      draft.skills = draft.skills.filter((skill) => skill.roleId !== id);
    });
  }
}
