import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createSeedState,
  ensureSavedProjects,
  ensureSeedPresets,
  ensureSeedRoles,
  parseState,
  type Run,
  type State,
} from '../domain';
import { DATA_PATH } from './store.tokens';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);
  private readonly state: State;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(@Inject(DATA_PATH) private readonly dataPath: string) {
    const loaded = this.loadFromDisk();
    this.state = loaded.state;
    const rolesAdded = ensureSeedRoles(this.state);
    const presetsAdded = ensureSeedPresets(this.state);
    const projectsAdded = ensureSavedProjects(this.state);
    if (
      loaded.wroteSeed ||
      rolesAdded ||
      presetsAdded ||
      projectsAdded ||
      this.failInterruptedRuns()
    ) {
      this.enqueueWrite();
    }
  }

  read(): State {
    return structuredClone(this.state);
  }

  mutate(change: (state: State) => void): void {
    change(this.state);
    this.enqueueWrite();
  }

  upsertRun(run: Run): void {
    const copy = structuredClone(run);
    const index = this.state.runs.findIndex((item) => item.id === copy.id);
    if (index === -1) {
      this.state.runs.unshift(copy);
      this.state.runs = this.state.runs.slice(0, 20);
    } else {
      this.state.runs[index] = copy;
    }
    this.enqueueWrite();
  }

  getRun(id: string): Run | null {
    const found = this.state.runs.find((item) => item.id === id);
    return found ? structuredClone(found) : null;
  }

  hasActiveRun(): boolean {
    return this.state.runs.some(
      (run) =>
        run.status === 'running' ||
        run.status === 'waiting_approval' ||
        run.status === 'waiting_user' ||
        run.status === 'waiting_plan',
    );
  }

  async whenSaved(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pending = this.writeChain;
      await pending;
      if (this.writeChain === pending) return;
    }
  }

  relevantRun(): Run | null {
    const active = this.state.runs.find(
      (run) =>
        run.status === 'running' ||
        run.status === 'waiting_approval' ||
        run.status === 'waiting_user' ||
        run.status === 'waiting_plan',
    );
    const chosen = active ?? this.state.runs[0];
    return chosen ? structuredClone(chosen) : null;
  }

  private loadFromDisk(): { state: State; wroteSeed: boolean } {
    try {
      const raw = readFileSync(this.dataPath, 'utf8');
      return {
        state: parseState(JSON.parse(raw) as unknown),
        wroteSeed: false,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { state: createSeedState(), wroteSeed: true };
      }
      // Старый файл доски или битый JSON не должен ронять сервер.
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.startsWith('Состояние'))
      ) {
        this.logger.warn(
          'Файл состояния не подошёл к новой модели, записываю начальные данные.',
        );
        return { state: createSeedState(), wroteSeed: true };
      }
      throw error;
    }
  }

  private failInterruptedRuns(): boolean {
    let changed = false;
    for (const run of this.state.runs) {
      if (
        run.status !== 'running' &&
        run.status !== 'waiting_approval' &&
        run.status !== 'waiting_user' &&
        run.status !== 'waiting_plan'
      ) {
        continue;
      }
      const stepTitle =
        run.stepIndex !== null && run.stepIndex >= 0
          ? (run.steps[run.stepIndex]?.title ?? null)
          : null;
      run.status = 'failed';
      run.error = stepTitle
        ? `Сервер перезапустился, пока шаг «${stepTitle}» ещё шёл. Нажмите «Повторить», чтобы продолжить с этого места.`
        : 'Сервер перезапустился, пока запуск ещё шёл. Нажмите «Повторить», чтобы продолжить.';
      run.updatedAt = new Date().toISOString();
      run.finishedAt = run.updatedAt;
      if (run.stepIndex !== null && run.steps[run.stepIndex]) {
        const step = run.steps[run.stepIndex];
        const line = run.error.startsWith('Ошибка:')
          ? run.error
          : `Ошибка: ${run.error}`;
        const last = step.messages[step.messages.length - 1];
        if (last?.text !== line) {
          step.messages.push({
            id: randomUUID(),
            at: run.updatedAt,
            author: 'role',
            text: line,
          });
        }
      }
      run.events.push({
        id: randomUUID(),
        at: run.updatedAt,
        kind: 'error',
        message: run.error,
        stepIndex: run.stepIndex,
      });
      changed = true;
    }
    return changed;
  }

  private enqueueWrite(): void {
    this.writeChain = this.writeChain
      .then(() => this.writeFile())
      .catch((error: unknown) => {
        this.logger.error('Failed to save pipeline state', error);
      });
  }

  private async writeFile(): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    await writeFile(this.dataPath, JSON.stringify(this.state, null, 2));
  }
}
