import {
  extractLoginUrl,
  parseStatusText,
  queryCliAuthStatus,
  runCliLogin,
  runCliLogout,
  setCliAuthExecForTests,
} from './cursor-cli-auth';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('cursor-cli-auth', () => {
  const previousBin = process.env.CURSOR_AGENT_BIN;
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipil-cli-auth-'));
    process.env.CURSOR_AGENT_BIN = join(directory, 'fake-agent');
    await writeFile(process.env.CURSOR_AGENT_BIN, '#!/bin/sh\n');
    await chmod(process.env.CURSOR_AGENT_BIN, 0o755);
  });

  afterEach(async () => {
    setCliAuthExecForTests(null);
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previousBin;
  });

  it('parseStatusText понимает json и текст', () => {
    expect(parseStatusText('{"authenticated":true,"email":"dev@example.com"}')).toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
    expect(parseStatusText('Not authenticated')).toEqual({
      signedIn: false,
      accountLabel: null,
    });
  });

  it('extractLoginUrl находит https-ссылку', () => {
    expect(
      extractLoginUrl('Open https://cursor.com/loginDeepControl?token=abc to continue'),
    ).toBe('https://cursor.com/loginDeepControl?token=abc');
  });

  it('queryCliAuthStatus читает agent status через подмену exec', async () => {
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'status') {
        return {
          stdout: JSON.stringify({ authenticated: true, email: 'cli@test.dev' }),
          stderr: '',
          code: 0,
        };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    await expect(queryCliAuthStatus()).resolves.toEqual({
      signedIn: true,
      accountLabel: 'cli@test.dev',
    });
  });

  it('runCliLogin передаёт NO_OPEN_BROWSER и отдаёт url из вывода', async () => {
    const seenEnv: NodeJS.ProcessEnv[] = [];
    setCliAuthExecForTests(async (input) => {
      seenEnv.push(input.env);
      if (input.args[0] === 'login') {
        input.onChunk?.(
          'stdout',
          'Visit https://cursor.com/cli-login?x=1 to sign in\n',
        );
        return { stdout: 'ok', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const urls: string[] = [];
    const result = await runCliLogin(process.env, (url) => urls.push(url));
    expect(result.ok).toBe(true);
    expect(urls[0]).toContain('https://cursor.com/cli-login');
    expect(seenEnv[0]?.NO_OPEN_BROWSER).toBe('1');
  });

  it('runCliLogout вызывает agent logout', async () => {
    const calls: string[][] = [];
    setCliAuthExecForTests(async (input) => {
      calls.push(input.args);
      return { stdout: '', stderr: '', code: 0 };
    });
    await runCliLogout();
    expect(calls.some((args) => args[0] === 'logout')).toBe(true);
  });
});
