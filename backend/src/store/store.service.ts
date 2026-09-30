import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSeedState, parseState, type Run, type State } from '../domain';
import { DATA_PATH } from './store.tokens';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);
  private readonly state: State;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(@Inject(DATA_PATH) private readonly dataPath: string) {
    const loaded = this.loadFromDisk();
    this.state = loaded.state;
    if (loaded.wroteSeed || this.failInterruptedRuns()) {
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

  hasRunningRun(): boolean {
    return this.state.runs.some((run) => run.status === 'running');
  }

  async whenSaved(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pending = this.writeChain;
      await pending;
      if (this.writeChain === pending) return;
    }
  }

  relevantRun(): Run | null {
    const running = this.state.runs.find((run) => run.status === 'running');
    const chosen = running ?? this.state.runs[0];
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
      throw error;
    }
  }

  private failInterruptedRuns(): boolean {
    let changed = false;
    for (const run of this.state.runs) {
      if (run.status !== 'running') continue;
      run.status = 'failed';
      run.error = 'The server restarted before this run finished.';
      run.updatedAt = new Date().toISOString();
      run.events.push({
        id: randomUUID(),
        at: run.updatedAt,
        kind: 'failed',
        message: run.error,
        stageIndex: run.stageIndex,
        roleId: run.ownerRoleId,
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
