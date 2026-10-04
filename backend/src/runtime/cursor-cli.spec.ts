import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAgentBinary,
  runCursorCliStep,
  setCursorCliExecForTests,
} from './cursor-cli';
import { ShellApprovalRequiredError } from './shell-allow';
import { WorkspaceTrustRequiredError } from './workspace-trust';

describe('runCursorCliStep', () => {
  const previousBin = process.env.CURSOR_AGENT_BIN;
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipil-cli-'));
    process.env.CURSOR_AGENT_BIN = join(directory, 'fake-agent');
    await writeFile(process.env.CURSOR_AGENT_BIN, '#!/bin/sh\n');
    await chmod(process.env.CURSOR_AGENT_BIN, 0o755);
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(async () => {
    setCursorCliExecForTests(null);
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previousBin;
  });

  it('вызывает agent -p --workspace с подменённым exec и CURSOR_API_KEY', async () => {
    const calls: Array<{
      binary: string;
      args: string[];
      prompt: string;
      env: NodeJS.ProcessEnv;
    }> = [];
    setCursorCliExecForTests(async (input) => {
      calls.push({
        binary: input.binary,
        args: input.args,
        prompt: input.prompt,
        env: input.env,
      });
      return { stdout: 'Ответ CLI для теста.', stderr: '', code: 0 };
    });
    const result = await runCursorCliStep(
      {
        token: '',
        task: 'Добавить README',
        stepTitle: 'Сборка',
        agentName: 'Сборщик',
        instructions: 'Собери по плану.',
        skills: [],
        projectFolder: directory,
        workspaceFile: null,
      },
      process.env,
      'cursor_cli_secret_key',
    );
    expect(result.text).toContain('CLI');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--workspace',
      directory,
    ]);
    expect(calls[0]?.prompt).toContain('README');
    expect(calls[0]?.env.CURSOR_API_KEY).toBe('cursor_cli_secret_key');
  });

  it('без ключа использует сессию CLI и не подставляет CURSOR_API_KEY', async () => {
    const calls: Array<{ env: NodeJS.ProcessEnv }> = [];
    setCursorCliExecForTests(async (input) => {
      calls.push({ env: input.env });
      return { stdout: 'Ответ по сессии.', stderr: '', code: 0 };
    });
    await runCursorCliStep(
      {
        token: '',
        task: 'x',
        stepTitle: 'y',
        agentName: 'z',
        instructions: '',
        skills: [],
        projectFolder: directory,
        workspaceFile: null,
      },
      process.env,
      null,
    );
    expect(calls[0]?.env.CURSOR_API_KEY).toBeUndefined();
  });

  it('передаёт --resume и сообщает session_id до завершения процесса', async () => {
    let duringCall = false;
    let seen: string | null = null;
    const args: string[][] = [];
    setCursorCliExecForTests((input) => {
      args.push(input.args);
      input.onChunk?.(
        'stdout',
        [
          JSON.stringify({
            type: 'system',
            subtype: 'init',
            session_id: 'sess-1',
          }),
          JSON.stringify({ type: 'result', result: 'Готово.' }),
        ].join('\n') + '\n',
      );
      duringCall = seen === 'sess-1';
      return Promise.resolve({ stdout: '', stderr: '', code: 0 });
    });
    const result = await runCursorCliStep(
      {
        token: '',
        task: 'Продолжи',
        stepTitle: 'Сборка',
        agentName: 'Сборщик',
        instructions: '',
        skills: [],
        projectFolder: directory,
        workspaceFile: null,
        resumeChatId: 'chat-9',
      },
      process.env,
      null,
      {
        onSession: (id) => {
          seen = id;
        },
      },
    );
    expect(duringCall).toBe(true);
    expect(result.cliSessionId).toBe('sess-1');
    expect(result.text).toBe('Готово.');
    expect(args[0]).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--resume',
      'chat-9',
      '--workspace',
      directory,
    ]);
  });

  it('с trust добавляет --trust и без него узнаёт отказ Workspace Trust', async () => {
    const calls: string[][] = [];
    setCursorCliExecForTests(async (input) => {
      calls.push(input.args);
      if (!input.args.includes('--trust')) {
        return {
          stdout: '',
          stderr:
            'Workspace Trust Required. Pass --trust if you trust this directory',
          code: 1,
        };
      }
      return { stdout: 'Доверенный ответ.', stderr: '', code: 0 };
    });
    const input = {
      token: '',
      task: 'x',
      stepTitle: 'y',
      agentName: 'z',
      instructions: '',
      skills: [],
      projectFolder: directory,
      workspaceFile: null,
    };
    await expect(
      runCursorCliStep(input, process.env, null),
    ).rejects.toBeInstanceOf(WorkspaceTrustRequiredError);
    const trusted = await runCursorCliStep(input, process.env, null, {
      trust: true,
    });
    expect(trusted.text).toBe('Доверенный ответ.');
    expect(calls[1]).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--workspace',
      directory,
    ]);
  });

  it('неразрешённая shell-команда останавливает шаг и показывает полный текст', async () => {
    const command = 'node .lint-check.mjs 2>&1 | tail -20';
    setCursorCliExecForTests(async () => ({
      stdout: [
        JSON.stringify({
          type: 'tool_call',
          subtype: 'started',
          tool_call: { shellToolCall: { args: { command } } },
        }),
        JSON.stringify({ type: 'result', result: 'Проверка прошла.' }),
      ].join('\n'),
      stderr: '',
      code: 0,
    }));
    const input = {
      token: '',
      task: 'x',
      stepTitle: 'y',
      agentName: 'z',
      instructions: '',
      skills: [],
      projectFolder: directory,
      workspaceFile: null,
    };
    await expect(
      runCursorCliStep(input, process.env, null, { shellAllowed: () => false }),
    ).rejects.toMatchObject({
      name: 'ShellApprovalRequiredError',
      command,
      base: 'node',
    });
    const allowed = await runCursorCliStep(input, process.env, null, {
      shellAllowed: (base) => base === 'node',
    });
    expect(allowed.text).toBe('Проверка прошла.');
  });

  it('без CLI объясняет причину по-русски', async () => {
    process.env.CURSOR_AGENT_BIN = join(directory, 'missing-agent');
    await expect(
      runCursorCliStep(
        {
          token: '',
          task: 'x',
          stepTitle: 'y',
          agentName: 'z',
          instructions: '',
          skills: [],
          projectFolder: directory,
          workspaceFile: null,
        },
        process.env,
        'cursor_cli_secret_key',
      ),
    ).rejects.toThrow('agent');
  });

  it('resolveAgentBinary находит бинарник из CURSOR_AGENT_BIN', () => {
    expect(resolveAgentBinary()).toContain('fake-agent');
  });
});
