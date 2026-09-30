/** Именованные цепочки: встроенные и сохранённые с холста. Сеть не вызывается. */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Agent,
  AgentKind,
  PipelinePreset,
  PresetStep,
  StepMode,
  Workflow,
  WorkflowStep,
} from '../domain';
import { seedPresets } from '../domain';
import { hasCycle } from '../runtime/step-graph';
import { StoreService } from '../store/store.service';

export interface PresetStepInput {
  key?: string;
  agentId: string;
  title: string;
  mode: StepMode;
  handoff: string;
  nextKeys?: string[];
}

const KIND_NAME: Record<AgentKind, string> = {
  orchestrator: 'оркестратор',
  analyst: 'аналитик',
  architect: 'архитектор',
  developer: 'разработчик',
  tester: 'тестировщик',
  planner: 'планировщик',
  builder: 'сборщик',
  reviewer: 'ревьюер',
  custom: 'свой агент',
};

@Injectable()
export class PresetsService {
  constructor(private readonly store: StoreService) {}

  /** Сначала шесть встроенных, затем свои по имени. */
  list(): PipelinePreset[] {
    const presets = this.store.read().presets;
    const builtins = seedPresets()
      .map((item) => presets.find((preset) => preset.id === item.id))
      .filter((item): item is PipelinePreset => Boolean(item));
    const custom = presets
      .filter((preset) => !preset.builtin)
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
    return [...builtins, ...custom];
  }

  get(id: string): PipelinePreset {
    const preset = this.store.read().presets.find((item) => item.id === id);
    if (!preset) throw new NotFoundException('Пресет не найден.');
    return preset;
  }

  /** Свежие id шагов, чтобы новый холст не делил узлы со старым запуском. */
  stepsFor(id: string): {
    name: string;
    description: string;
    steps: WorkflowStep[];
  } {
    const preset = this.get(id);
    const steps = this.buildSteps(preset, this.store.read().agents);
    return { name: preset.name, description: preset.description, steps };
  }

  /** Новый процесс с цепочкой пресета. Запуск по-прежнему идёт имитацией. */
  open(id: string): Workflow {
    const built = this.stepsFor(id);
    const workflow: Workflow = {
      id: randomUUID(),
      name: built.name,
      description: built.description,
      steps: built.steps,
    };
    this.store.mutate((state) => {
      state.workflows.push(workflow);
    });
    return workflow;
  }

  save(
    name: string,
    description: string,
    steps: PresetStepInput[],
  ): PipelinePreset {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Пресету нужно имя.');
    if (trimmed.length > 80) {
      throw new BadRequestException('Имя пресета короче 80 символов.');
    }
    const taken = (item: { name: string }) =>
      item.name.localeCompare(trimmed, 'ru', { sensitivity: 'accent' }) === 0;
    if (seedPresets().some(taken) || this.store.read().presets.some(taken)) {
      throw new BadRequestException('Пресет с таким именем уже есть.');
    }
    const note = description.trim();
    if (note.length > 400) {
      throw new BadRequestException('Описание пресета короче 400 символов.');
    }
    const stored = this.normalize(steps);
    const preset: PipelinePreset = {
      id: randomUUID(),
      name: trimmed,
      description: note || describeSteps(stored),
      builtin: false,
      steps: stored,
    };
    this.store.mutate((state) => {
      state.presets.push(preset);
    });
    return preset;
  }

  remove(id: string): void {
    const preset = this.get(id);
    if (preset.builtin) {
      throw new BadRequestException('Встроенный пресет нельзя удалить.');
    }
    this.store.mutate((state) => {
      state.presets = state.presets.filter((item) => item.id !== id);
    });
  }

  private buildSteps(preset: PipelinePreset, agents: Agent[]): WorkflowStep[] {
    if (preset.steps.length === 0) {
      throw new BadRequestException('В пресете нужен хотя бы один шаг.');
    }
    const idByKey = new Map<string, string>();
    for (const step of preset.steps) {
      idByKey.set(step.key, randomUUID());
    }
    const steps = preset.steps.map((step) => {
      const agent = this.resolveAgent(preset.name, step, agents);
      const nextIds = step.nextKeys.map((key) => {
        const nextId = idByKey.get(key);
        if (!nextId) {
          throw new BadRequestException(
            'Связь пресета ведёт на неизвестный шаг.',
          );
        }
        return nextId;
      });
      const id = idByKey.get(step.key);
      if (!id) throw new BadRequestException('У шага пресета нет ключа.');
      return {
        id,
        agentId: agent.id,
        title: step.title,
        mode: step.mode,
        handoff: step.handoff,
        nextIds,
      };
    });
    if (hasCycle(steps)) {
      throw new BadRequestException('Связь замыкает конвейер.');
    }
    return steps;
  }

  private resolveAgent(
    presetName: string,
    step: PresetStep,
    agents: Agent[],
  ): Agent {
    if (step.agentId) {
      const exact = agents.find((agent) => agent.id === step.agentId);
      if (exact) return exact;
    }
    const byKind = agents.find((agent) => agent.kind === step.kind);
    if (byKind) return byKind;
    throw new BadRequestException(
      `Для пресета «${presetName}» нужен агент: ${KIND_NAME[step.kind]}.`,
    );
  }

  private normalize(steps: PresetStepInput[]): PresetStep[] {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new BadRequestException('В пресете нужен хотя бы один шаг.');
    }
    if (steps.length > 40) {
      throw new BadRequestException('В пресете не больше 40 шагов.');
    }
    const agents = this.store.read().agents;
    const used = new Set<string>();
    const stored: PresetStep[] = steps.map((step) => {
      if (!step || typeof step.agentId !== 'string') {
        throw new BadRequestException(
          'У каждого шага должен быть существующий агент.',
        );
      }
      const agent = agents.find((item) => item.id === step.agentId);
      if (!agent) {
        throw new BadRequestException(
          'У каждого шага должен быть существующий агент.',
        );
      }
      if (typeof step.title !== 'string' || !step.title.trim()) {
        throw new BadRequestException('У каждого шага должно быть название.');
      }
      if (step.title.trim().length > 80) {
        throw new BadRequestException('Название шага короче 80 символов.');
      }
      if (
        step.mode !== 'automatic' &&
        step.mode !== 'approval' &&
        step.mode !== 'question'
      ) {
        throw new BadRequestException(
          'Режим шага: automatic, approval или question.',
        );
      }
      if (typeof step.handoff !== 'string') {
        throw new BadRequestException(
          'У каждого шага должна быть заметка передачи.',
        );
      }
      let key = typeof step.key === 'string' ? step.key.trim() : '';
      if (!key || used.has(key)) key = randomUUID();
      used.add(key);
      const nextKeys = Array.isArray(step.nextKeys)
        ? step.nextKeys.filter((id): id is string => typeof id === 'string')
        : [];
      return {
        key,
        agentId: agent.id,
        kind: agent.kind,
        title: step.title.trim(),
        mode: step.mode,
        handoff: step.handoff.trim(),
        nextKeys,
      };
    });
    const known = new Set(stored.map((step) => step.key));
    for (const step of stored) {
      step.nextKeys = [
        ...new Set(step.nextKeys.filter((key) => key !== step.key)),
      ];
      if (step.nextKeys.some((key) => !known.has(key))) {
        throw new BadRequestException('Связь ведёт на неизвестный шаг.');
      }
    }
    const probe: WorkflowStep[] = stored.map((step) => ({
      id: step.key,
      agentId: step.agentId ?? '',
      title: step.title,
      mode: step.mode,
      handoff: step.handoff,
      nextIds: step.nextKeys,
    }));
    if (hasCycle(probe)) {
      throw new BadRequestException('Связь замыкает конвейер.');
    }
    return stored;
  }
}

function describeSteps(steps: PresetStep[]): string {
  const titles = steps.map((step) => step.title);
  const branched = steps.some((step) => step.nextKeys.length > 1);
  const text = branched ? `Шаги: ${titles.join(', ')}.` : titles.join(' → ');
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}
