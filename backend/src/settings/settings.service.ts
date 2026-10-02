import { BadRequestException, Injectable } from '@nestjs/common';
import { tokenHint, type CursorConnectionMode } from '../domain';
import {
  type CliLoginSnapshot,
  queryCliAuthStatus,
  runCliLogin,
  runCliLogout,
} from '../runtime/cursor-cli-auth';
import { isAgentCliAvailable } from '../runtime/cursor-cli';
import { StoreService } from '../store/store.service';

export type CursorConnectionSource = 'none' | 'saved' | 'env' | 'session';

export interface CursorConnection {
  connected: boolean;
  source: CursorConnectionSource;
  hint: string | null;
  mode: CursorConnectionMode;
  cliAgentAvailable: boolean;
  cliSessionSignedIn: boolean;
  cliAccountLabel: string | null;
  cliLogin: CliLoginSnapshot;
}

type CliSessionSnapshot = {
  signedIn: boolean;
  accountLabel: string | null;
  checkedAt: number;
};

@Injectable()
export class SettingsService {
  private cliSession: CliSessionSnapshot = {
    signedIn: false,
    accountLabel: null,
    checkedAt: 0,
  };

  private cliLoginState: CliLoginSnapshot = {
    status: 'idle',
    loginUrl: null,
    message: null,
  };

  private loginTask: Promise<void> | null = null;

  constructor(private readonly store: StoreService) {}

  /** Только для unit-тестов. */
  setCliSessionSnapshotForTests(snapshot: Partial<CliSessionSnapshot>): void {
    this.cliSession = { ...this.cliSession, ...snapshot, checkedAt: Date.now() };
  }

  connectionMode(): CursorConnectionMode {
    return this.store.read().cursorMode;
  }

  cliSessionSignedIn(): boolean {
    return this.cliSession.signedIn;
  }

  /** Ключ или сохранённая сессия CLI. */
  cliAuthReady(env: NodeJS.ProcessEnv = process.env): boolean {
    return this.cliApiKey(env) !== null || this.cliSessionSignedIn();
  }

  /** Публичный вид подключения. Полные секреты сюда не попадают. */
  connection(env: NodeJS.ProcessEnv = process.env): CursorConnection {
    return this.buildConnection(env);
  }

  async connectionView(env: NodeJS.ProcessEnv = process.env): Promise<CursorConnection> {
    await this.ensureCliAuthChecked(env, 5_000);
    return this.buildConnection(env);
  }

  private buildConnection(env: NodeJS.ProcessEnv): CursorConnection {
    const mode = this.connectionMode();
    const cliAgentAvailable = isAgentCliAvailable(env);
    const cliLogin = { ...this.cliLoginState };
    if (mode === 'cli') {
      const saved = this.store.read().cursorCliApiKey;
      const fromEnv = env.CURSOR_API_KEY?.trim();
      const sessionSignedIn = this.cliSessionSignedIn();
      let source: CursorConnectionSource = 'none';
      let hint: string | null = null;
      if (saved && saved.length >= 8) {
        source = 'saved';
        hint = tokenHint(saved);
      } else if (fromEnv && fromEnv.length >= 8) {
        source = 'env';
      } else if (sessionSignedIn) {
        source = 'session';
      }
      const connected = cliAgentAvailable && this.cliAuthReady(env);
      return {
        connected,
        source,
        hint,
        mode,
        cliAgentAvailable,
        cliSessionSignedIn: sessionSignedIn,
        cliAccountLabel: sessionSignedIn ? this.cliSession.accountLabel : null,
        cliLogin,
      };
    }
    const saved = this.store.read().cursorToken;
    if (saved && saved.length >= 8) {
      return {
        connected: true,
        source: 'saved',
        hint: tokenHint(saved),
        mode,
        cliAgentAvailable,
        cliSessionSignedIn: false,
        cliAccountLabel: null,
        cliLogin,
      };
    }
    const fromEnv = env.CURSOR_API_TOKEN?.trim();
    if (fromEnv && fromEnv.length >= 8) {
      return {
        connected: true,
        source: 'env',
        hint: null,
        mode,
        cliAgentAvailable,
        cliSessionSignedIn: false,
        cliAccountLabel: null,
        cliLogin,
      };
    }
    return {
      connected: false,
      source: 'none',
      hint: null,
      mode,
      cliAgentAvailable,
      cliSessionSignedIn: false,
      cliAccountLabel: null,
      cliLogin,
    };
  }

  /** Шаг Cursor в текущем режиме можно запускать без ошибки конфигурации. */
  cursorReady(env: NodeJS.ProcessEnv = process.env): boolean {
    const mode = this.connectionMode();
    if (mode === 'cli') {
      return isAgentCliAvailable(env) && this.cliAuthReady(env);
    }
    return this.connection(env).connected;
  }

  async ensureCliAuthChecked(
    env: NodeJS.ProcessEnv = process.env,
    maxAgeMs = 30_000,
  ): Promise<void> {
    if (this.connectionMode() !== 'cli') return;
    if (!isAgentCliAvailable(env)) {
      this.cliSession = { signedIn: false, accountLabel: null, checkedAt: Date.now() };
      return;
    }
    if (maxAgeMs > 0 && Date.now() - this.cliSession.checkedAt < maxAgeMs) {
      return;
    }
    const status = await queryCliAuthStatus(env);
    this.cliSession = {
      signedIn: status.signedIn,
      accountLabel: status.accountLabel,
      checkedAt: Date.now(),
    };
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

  /** Ключ CURSOR_API_KEY для локального CLI. Только внутри backend. */
  cliApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
    const saved = this.store.read().cursorCliApiKey;
    if (saved && saved.trim().length >= 8) return saved.trim();
    const fromEnv = env.CURSOR_API_KEY?.trim();
    if (fromEnv && fromEnv.length >= 8) return fromEnv;
    return null;
  }

  private validateSecret(value: string, label: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 8) {
      throw new BadRequestException(`${label} короче 8 символов сохранить нельзя.`);
    }
    if (trimmed.length > 500) {
      throw new BadRequestException(`${label} длиннее 500 символов.`);
    }
    return trimmed;
  }

  save(token: string): CursorConnection {
    const trimmed = this.validateSecret(token, 'Токен');
    this.store.mutate((state) => {
      state.cursorToken = trimmed;
    });
    return this.connection();
  }

  saveCliApiKey(apiKey: string): CursorConnection {
    const trimmed = this.validateSecret(apiKey, 'Ключ');
    this.store.mutate((state) => {
      state.cursorCliApiKey = trimmed;
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
      if (state.cursorMode === 'cli') state.cursorCliApiKey = null;
      else state.cursorToken = null;
    });
    return this.connection();
  }

  async startCliLogin(env: NodeJS.ProcessEnv = process.env): Promise<CursorConnection> {
    if (this.connectionMode() !== 'cli') {
      throw new BadRequestException('Вход через CLI доступен только в режиме CLI.');
    }
    if (!isAgentCliAvailable(env)) {
      throw new BadRequestException('CLI «agent» не найден на сервере.');
    }
    if (this.cliLoginState.status === 'pending' && this.loginTask) {
      return this.connection(env);
    }
    this.cliLoginState = {
      status: 'pending',
      loginUrl: null,
      message: 'Ожидание ссылки для входа…',
    };
    this.loginTask = this.runLoginTask(env);
    void this.loginTask.finally(() => {
      this.loginTask = null;
    });
    return this.connection(env);
  }

  private async runLoginTask(env: NodeJS.ProcessEnv): Promise<void> {
    try {
      const outcome = await runCliLogin(env, (url) => {
        if (!this.cliLoginState.loginUrl) {
          this.cliLoginState = {
            ...this.cliLoginState,
            loginUrl: url,
            message: 'Откройте ссылку и войдите в Cursor.',
          };
        }
      });
      if (outcome.ok) {
        await this.ensureCliAuthChecked(env, 0);
        this.cliLoginState = {
          status: 'success',
          loginUrl: this.cliLoginState.loginUrl,
          message: 'Вход выполнен.',
        };
        return;
      }
      this.cliLoginState = {
        status: 'failed',
        loginUrl: this.cliLoginState.loginUrl,
        message: outcome.message ?? 'Не удалось выполнить вход.',
      };
    } catch (error) {
      this.cliLoginState = {
        status: 'failed',
        loginUrl: this.cliLoginState.loginUrl,
        message:
          error instanceof Error ? error.message : 'Не удалось выполнить вход.',
      };
    }
  }

  async logoutCliSession(env: NodeJS.ProcessEnv = process.env): Promise<CursorConnection> {
    if (this.connectionMode() !== 'cli') {
      throw new BadRequestException('Выход из CLI доступен только в режиме CLI.');
    }
    if (!isAgentCliAvailable(env)) {
      throw new BadRequestException('CLI «agent» не найден на сервере.');
    }
    await runCliLogout(env);
    this.cliSession = { signedIn: false, accountLabel: null, checkedAt: Date.now() };
    this.cliLoginState = { status: 'idle', loginUrl: null, message: null };
    return this.connection(env);
  }
}
