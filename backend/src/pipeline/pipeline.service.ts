import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PipelineStage } from '../domain';
import { StoreService } from '../store/store.service';

export interface StageInput {
  id?: string;
  roleId: string;
  handoffInstruction: string;
}

@Injectable()
export class PipelineService {
  constructor(private readonly store: StoreService) {}

  get(): PipelineStage[] {
    return this.store.read().stages;
  }

  replace(input: StageInput[]): PipelineStage[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new BadRequestException('The pipeline needs at least one stage.');
    }
    const roles = this.store.read().roles;
    const used = new Set<string>();
    const stages = input.map((stage, index) => {
      if (!stage || typeof stage.roleId !== 'string' || !stage.roleId.trim()) {
        throw new BadRequestException('Every stage needs a role.');
      }
      if (!roles.some((role) => role.id === stage.roleId)) {
        throw new BadRequestException(
          'Every stage needs a role that still exists.',
        );
      }
      if (typeof stage.handoffInstruction !== 'string') {
        throw new BadRequestException('Every stage needs a handoff note.');
      }
      const handoff = stage.handoffInstruction.trim();
      if (handoff.length > 1000) {
        throw new BadRequestException(
          'Keep each handoff under 1000 characters.',
        );
      }
      const isLast = index === input.length - 1;
      if (!isLast && handoff.length === 0) {
        throw new BadRequestException(
          'Write a handoff for every stage except the last.',
        );
      }
      let id = typeof stage.id === 'string' ? stage.id.trim() : '';
      if (!id || used.has(id)) id = randomUUID();
      used.add(id);
      return { id, roleId: stage.roleId, handoffInstruction: handoff };
    });
    this.store.mutate((state) => {
      state.stages = stages;
    });
    return stages;
  }
}
