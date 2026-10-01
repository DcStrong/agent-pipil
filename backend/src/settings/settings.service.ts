import { BadRequestException, Injectable } from '@nestjs/common';
import { tokenHint, type CursorConnectionMode } from '../domain';
import { isAgentCliAvailable } from '../runtime/cursor-cli';
import { StoreService } from '../store/store.service';

export interface CursorConnection {
  connected: boolean;
  source: 'none' | 'saved' | 'env';
  hint: string | null;
  mode: CursorConnectionMode;
}

@Injectable()
export class SettingsService {
  constructor(private readonly store: StoreService) {}

  connectionMode(): CursorConnectionMode {
    return this.store.read().cursorMode;
  }

  /** Публичный вид подключения. Полный токен сюда не попадает. */
  connection(env: NodeJS.ProcessEnv = process.env): CursorConnection {
    const mode = this.connectionMode();
    if (mode === 'cli') {
      return {
        connected: isAgentCliAvailable(env),
        source: 'none',
        hint: null,
        mode,
      };
    }
    const saved = this.store.read().cursorToken;
    if (saved && saved.length >= 8) {
      return {
        connected: true,
        source: 'saved',
        hint: tokenHint(saved),
        mode,
      };
    }
    const fromEnv = env.CURSOR_API_TOKEN?.trim();
    if (fromEnv && fromEnv.length >= 8) {
      return { connected: true, source: 'env', hint: null, mode };
    }
    return { connected: false, source: 'none', hint: null, mode };
  }

  /** Шаг Cursor в текущем режиме можно запускать без ошибки конфигурации. */
  cursorReady(env: NodeJS.ProcessEnv = process.env): boolean {
    return this.connection(env).connected;
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

  setMode(mode: CursorConnectionMode): CursorConnection {
    if (mode !== 'cli' && mode !== 'api') {
      throw new BadRequestException('Режим подключения: cli или api.');
    }
    this.store.mutate((state) => {
      state.cursorMode = mode;
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
