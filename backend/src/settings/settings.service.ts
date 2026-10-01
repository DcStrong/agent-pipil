import { BadRequestException, Injectable } from '@nestjs/common';
import { tokenHint } from '../domain';
import { StoreService } from '../store/store.service';

export interface CursorConnection {
  connected: boolean;
  source: 'none' | 'saved' | 'env';
  hint: string | null;
}

@Injectable()
export class SettingsService {
  constructor(private readonly store: StoreService) {}

  /** Публичный вид подключения. Полный токен сюда не попадает. */
  connection(env: NodeJS.ProcessEnv = process.env): CursorConnection {
    const saved = this.store.read().cursorToken;
    if (saved && saved.length >= 8) {
      return { connected: true, source: 'saved', hint: tokenHint(saved) };
    }
    const fromEnv = env.CURSOR_API_TOKEN?.trim();
    if (fromEnv && fromEnv.length >= 8) {
      return { connected: true, source: 'env', hint: null };
    }
    return { connected: false, source: 'none', hint: null };
  }

  /** Токен для внутреннего решения «подключён ли Cursor». Наружу не отдаётся. */
  hasToken(env: NodeJS.ProcessEnv = process.env): boolean {
    return this.connection(env).connected;
  }

  /** Секрет для вызова Cloud Agents API. Только внутри backend. */
  apiToken(env: NodeJS.ProcessEnv = process.env): string | null {
    const saved = this.store.read().cursorToken;
    if (saved && saved.trim().length >= 8) return saved.trim();
    const fromEnv = env.CURSOR_API_TOKEN?.trim();
    if (fromEnv && fromEnv.length >= 8) return fromEnv;
    return null;
  }

  save(token: string): CursorConnection {
    const trimmed = token.trim();
    if (trimmed.length < 8) {
      throw new BadRequestException(
        'Токен короче 8 символов сохранить нельзя.',
      );
    }
    if (trimmed.length > 500) {
      throw new BadRequestException('Токен длиннее 500 символов.');
    }
    this.store.mutate((state) => {
      state.cursorToken = trimmed;
    });
    return this.connection();
  }

  clear(): CursorConnection {
    this.store.mutate((state) => {
      state.cursorToken = null;
    });
    return this.connection();
  }
}
