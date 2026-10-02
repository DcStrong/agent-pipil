import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CURSOR_CLI_MISSING_KEY_MESSAGE,
  resolveAgentBinary,
  runCursorCliStep,
  setCursorCliExecForTests,
} from './cursor-cli';

describe('runCursorCliStep', () => {
  const previousBin = process.env.CURSOR_AGENT_BIN;
  const previousKey = process.env.CURSOR_API_KEY;
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
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previousBin;
    if (previousKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previousKey;
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
    expect(calls[0]?.args).toEqual(['-p', '--workspace', directory]);
    expect(calls[0]?.prompt).toContain('README');
    expect(calls[0]?.env.CURSOR_API_KEY).toBe('cursor_cli_secret_key');
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

  it('без ключа объясняет причину по-русски', async () => {
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
        null,
      ),
    ).rejects.toThrow(CURSOR_CLI_MISSING_KEY_MESSAGE);
  });

  it('resolveAgentBinary находит бинарник из CURSOR_AGENT_BIN', () => {
    expect(resolveAgentBinary()).toContain('fake-agent');
  });
});
