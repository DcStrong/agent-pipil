import {
  AGENT_STATUS_JSON_AUTHENTICATED,
  AGENT_STATUS_JSON_LOGGED_IN_SNAKE,
  AGENT_STATUS_JSON_STATUS_STRING,
  AGENT_STATUS_JSON_UNKNOWN,
  AGENT_STATUS_TEXT_LOGGED_IN,
  AGENT_STATUS_TEXT_WHOAMI,
} from './agent-status-fixtures';
import {
  CLI_LOGIN_NO_URL_MESSAGE,
  extractDeepLoginUrlFromBuffer,
  extractLoginUrl,
  normalizeCliLoginOutput,
  parseStatusText,
  queryCliAuthStatus,
  runCliLogin,
  runCliLogout,
  setCliAuthExecForTests,
} from './cursor-cli-auth';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USER_BROKEN_URL =
  'https://cursor.com/loginDeepControl?  challenge=KCGv4hy6ZiS_AGFP5QZ9RJSJ_5nfgpDTpOwBueVJ3M0&uuid=2d833842-0035-4b68-  a490-4cb3d4c95cf3&mode=login&redirectTarget=cli';

const USER_CLEAN_URL =
  'https://cursor.com/loginDeepControl?challenge=KCGv4hy6ZiS_AGFP5QZ9RJSJ_5nfgpDTpOwBueVJ3M0&uuid=2d833842-0035-4b68-a490-4cb3d4c95cf3&mode=login&redirectTarget=cli';

function statusSignedIn() {
  return {
    stdout: JSON.stringify({ authenticated: true, email: 'dev@example.com' }),
    stderr: '',
    code: 0,
  };
}

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
    expect(parseStatusText(AGENT_STATUS_JSON_AUTHENTICATED)).toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
    expect(parseStatusText(AGENT_STATUS_TEXT_LOGGED_IN)).toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
    expect(parseStatusText(AGENT_STATUS_JSON_LOGGED_IN_SNAKE)).toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
    expect(parseStatusText(AGENT_STATUS_JSON_STATUS_STRING)).toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
    expect(parseStatusText(AGENT_STATUS_JSON_UNKNOWN)).toEqual({
      signedIn: false,
      accountLabel: null,
    });
    expect(parseStatusText('Not authenticated')).toEqual({
      signedIn: false,
      accountLabel: null,
    });
    expect(parseStatusText('Вошли как user@corp.dev')).toEqual({
      signedIn: true,
      accountLabel: 'user@corp.dev',
    });
  });

  it('queryCliAuthStatus понимает текстовый whoami-вывод CLI', async () => {
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] !== 'status') {
        return { stdout: '', stderr: '', code: 1 };
      }
      if (input.args.includes('--format')) {
        return { stdout: AGENT_STATUS_JSON_UNKNOWN, stderr: '', code: 0 };
      }
      return { stdout: AGENT_STATUS_TEXT_WHOAMI, stderr: '', code: 0 };
    });
    await expect(queryCliAuthStatus()).resolves.toEqual({
      signedIn: true,
      accountLabel: 'cli@test.dev',
    });
  });

  it('extractLoginUrl убирает пробелы из дословной строки пользователя', () => {
    expect(extractLoginUrl(USER_BROKEN_URL)).toBe(USER_CLEAN_URL);
    expect(extractLoginUrl(USER_BROKEN_URL)?.includes(' ')).toBe(false);
  });

  it('extractLoginUrl убирает перенос после ? и отступ на следующей строке', () => {
    const raw = `Open URL:\nhttps://cursor.com/loginDeepControl?\n challenge=KCGv4hy6ZiS_AGFP5QZ9RJSJ_5nfgpDTpOwBueVJ3M0&uuid=2d833842-0035-4b68-\n  a490-4cb3d4c95cf3&mode=login&redirectTarget=cli\n`;
    expect(extractLoginUrl(raw)).toBe(USER_CLEAN_URL);
    expect(extractDeepLoginUrlFromBuffer(raw)).toBe(USER_CLEAN_URL);
  });

  it('extractLoginUrl возвращает loginDeepControl из типичного вывода CLI без изменений', () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=AbCdEf0123456789%2B%2F%3D&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli';
    const cliText = `Open this URL to authenticate with Cursor:\n\n ${url}\n`;
    expect(extractLoginUrl(cliText)).toBe(url);
  });

  it('extractLoginUrl склеивает url, перенесённый терминалом на новую строку', () => {
    const part1 =
      'https://cursor.com/loginDeepControl?challenge=aaaaBBBBccccDDDDeeeeFFFF0000';
    const part2 = '11112222&uuid=99999999-aaaa-bbbb-cccc-dddddddddddd&mode=login&redirectTarget=cli';
    const full = part1 + part2;
    const cliText = `Open URL:\n${part1}\n${part2}\nWaiting...\n`;
    expect(extractLoginUrl(cliText)).toBe(full);
  });

  it('extractLoginUrl предпочитает loginDeepControl, а не более длинный посторонний https', () => {
    const login =
      'https://cursor.com/loginDeepControl?challenge=short&uuid=u&mode=login&redirectTarget=cli';
    const noise = `Docs: https://cursor.com/docs/cli/reference/authentication?long=${'x'.repeat(200)}`;
    expect(extractLoginUrl(`${noise}\n${login}`)).toBe(login);
  });

  it('queryCliAuthStatus читает agent status через подмену exec', async () => {
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'status') {
        return statusSignedIn();
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    await expect(queryCliAuthStatus()).resolves.toEqual({
      signedIn: true,
      accountLabel: 'dev@example.com',
    });
  });

  it('queryCliAuthStatus при неразборчивом json с кодом 0 идёт в обычный status', async () => {
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] !== 'status') {
        return { stdout: '', stderr: '', code: 1 };
      }
      if (input.args.includes('--format')) {
        return { stdout: 'unexpected output', stderr: '', code: 0 };
      }
      return { stdout: 'Logged in as cli@test.dev', stderr: '', code: 0 };
    });
    await expect(queryCliAuthStatus()).resolves.toEqual({
      signedIn: true,
      accountLabel: 'cli@test.dev',
    });
  });

  it('runCliLogin передаёт NO_OPEN_BROWSER и отдаёт url из вывода byte-в-byte', async () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login&redirectTarget=cli';
    const seenEnv: NodeJS.ProcessEnv[] = [];
    setCliAuthExecForTests(async (input) => {
      seenEnv.push(input.env);
      if (input.args[0] === 'login') {
        input.onChunk?.('stdout', `Visit ${url} to sign in\n`);
        return { stdout: 'ok', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        return statusSignedIn();
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const urls: string[] = [];
    const result = await runCliLogin(process.env, (u) => urls.push(u));
    expect(result.ok).toBe(true);
    expect(urls[urls.length - 1]).toBe(url);
    expect(result.loginUrl).toBe(url);
    expect(extractLoginUrl(result.rawOutput)).toBe(url);
    expect(seenEnv[0]?.NO_OPEN_BROWSER).toBe('1');
  });

  it('runCliLogin собирает url из нескольких chunk без обрезки', async () => {
    const full =
      'https://cursor.com/loginDeepControl?challenge=' +
      'a'.repeat(120) +
      '&uuid=' +
      'b'.repeat(36) +
      '&mode=login&redirectTarget=cli';
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        const half = Math.floor(full.length / 2);
        input.onChunk?.('stdout', full.slice(0, half));
        input.onChunk?.('stdout', full.slice(half) + '\n');
        return { stdout: '', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        return statusSignedIn();
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const result = await runCliLogin(process.env);
    expect(result.ok).toBe(true);
    expect(result.loginUrl).toBe(full);
  });

  it('runCliLogin без ссылки в выводе — русская ошибка', async () => {
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        return { stdout: 'waiting for browser', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        return { stdout: 'Not authenticated', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const result = await runCliLogin(process.env);
    expect(result.ok).toBe(false);
    expect(result.loginUrl).toBeNull();
    expect(result.message).toBe(CLI_LOGIN_NO_URL_MESSAGE);
  });

  it('runCliLogin с url, но без успешного входа — русская подсказка', async () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=y&mode=login&redirectTarget=cli';
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        input.onChunk?.('stdout', `${url}\n`);
        return { stdout: '', stderr: 'timeout', code: 1 };
      }
      if (input.args[0] === 'status') {
        return { stdout: 'Not authenticated', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const result = await runCliLogin(process.env);
    expect(result.ok).toBe(false);
    expect(result.loginUrl).toBe(url);
    expect(result.message).toContain('timeout');
  });

  it('runCliLogin успех: код 0 и agent status с сессией', async () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli';
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        input.onChunk?.('stdout', `${url}\n`);
        return { stdout: '', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        return statusSignedIn();
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    const result = await runCliLogin(process.env);
    expect(result.ok).toBe(true);
  });

  it('runCliLogin: status уже signed-in до выхода login — ok через onStatusCheck', async () => {
    jest.useFakeTimers();
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli';
    let loginRelease: (() => void) | null = null;
    const loginDone = new Promise<void>((resolve) => {
      loginRelease = resolve;
    });
    setCliAuthExecForTests(async (input) => {
      if (input.args[0] === 'login') {
        input.onChunk?.('stdout', `${url}\n`);
        await loginDone;
        return { stdout: '', stderr: '', code: 0 };
      }
      if (input.args[0] === 'status') {
        return statusSignedIn();
      }
      return { stdout: '', stderr: '', code: 1 };
    });
    let polledSignedIn = false;
    const loginPromise = runCliLogin(process.env, undefined, async () => {
      const status = await queryCliAuthStatus(process.env);
      if (status.signedIn) polledSignedIn = true;
    });
    await jest.advanceTimersByTimeAsync(2_100);
    expect(polledSignedIn).toBe(true);
    loginRelease?.();
    const result = await loginPromise;
    jest.useRealTimers();
    expect(result.ok).toBe(true);
  });

  it('normalizeCliLoginOutput возвращает компактную deep-ссылку', () => {
    const joined = normalizeCliLoginOutput(
      'https://cursor.com/loginDeepControl?\n challenge=abc\n&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli',
    );
    expect(joined).toBe(
      'https://cursor.com/loginDeepControl?challenge=abc&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli',
    );
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
