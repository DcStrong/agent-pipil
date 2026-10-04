import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryCliAuthStatus, setCliAuthExecForTests } from '../runtime/cursor-cli-auth';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { SettingsService } from './settings.service';

describe('SettingsService CLI session', () => {
  let directory = '';
  let settings: SettingsService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipil-settings-'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        SettingsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
      ],
    }).compile();
    settings = moduleRef.get(SettingsService);
    settings.setMode('cli');
    process.env.CURSOR_AGENT_BIN = join(directory, 'fake-agent');
    await writeFile(process.env.CURSOR_AGENT_BIN, '#!/bin/sh\n');
    await chmod(process.env.CURSOR_AGENT_BIN, 0o755);
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'status') {
        return {
          stdout: JSON.stringify({ authenticated: true, email: 'dev@example.com' }),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
  });

  afterEach(async () => {
    setCliAuthExecForTests(null);
    delete process.env.CURSOR_AGENT_BIN;
    await rm(directory, { recursive: true, force: true });
  });

  it('ensureCliAuthChecked подхватывает agent status', async () => {
    await expect(queryCliAuthStatus(process.env)).resolves.toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
    await settings.ensureCliAuthChecked(process.env, 0);
    expect(settings.cliSessionSignedIn()).toBe(true);
    expect(settings.cliAuthReady()).toBe(true);
  });

  it('startCliLogin переходит в success, когда status signed-in до выхода login', async () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli';
    let statusCalls = 0;
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        input.onChunk?.('stdout', `${url}\n`);
        await new Promise((r) => setTimeout(r, 100));
        return { stdout: '', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        statusCalls += 1;
        return {
          stdout: JSON.stringify({ authenticated: true, email: 'dev@example.com' }),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    await settings.startCliLogin(process.env);
    await new Promise((r) => setTimeout(r, 250));
    const view = settings.connection(process.env);
    expect(view.cliLogin.status).toBe('success');
    expect(view.cliSessionSignedIn).toBe(true);
    expect(statusCalls).toBeGreaterThan(0);
  });

  it('connectionView во время pending отдаёт success без кэша «не вошли»', async () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli';
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        input.onChunk?.('stdout', `${url}\n`);
        await new Promise((r) => setTimeout(r, 500));
        return { stdout: '', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        return {
          stdout: 'Logged in as dev@example.com',
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    await settings.startCliLogin(process.env);
    await new Promise((r) => setTimeout(r, 250));
    const view = await settings.connectionView(process.env);
    expect(view.cliLogin.status).toBe('success');
    expect(view.cliSessionSignedIn).toBe(true);
    expect(view.connected).toBe(true);
  });
});
