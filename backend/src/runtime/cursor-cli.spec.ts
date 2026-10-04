import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAgentBinary,
  runCursorCliStep,
  setAgentHelpTextForTests,
  setCursorCliExecForTests,
} from './cursor-cli';

describe('runCursorCliStep', () => {
  const previousBin = process.env.CURSOR_AGENT_BIN;
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipil-cli-'));
    process.env.CURSOR_AGENT_BIN = join(directory, 'fake-agent');
    await writeFile(process.env.CURSOR_AGENT_BIN!, '#!/bin/sh\n');
    await chmod(process.env.CURSOR_AGENT_BIN!, 0o755);
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(async () => {
    setCursorCliExecForTests(null);
    setAgentHelpTextForTests(null);
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previousBin;
  });

  it('вызывает agent -p --workspace с подменённым exec и CURSOR_API_KEY', async () => {
    setAgentHelpTextForTests('--trust\n--resume');
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
      '--workspace',
      directory,
      '--trust',
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

  it('без CLI объясняет причину по-русски', async () => {
    delete process.env.CURSOR_AGENT_BIN;
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
