import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAgentBinary,
  runCursorCliStep,
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
  });

  afterEach(async () => {
    setCursorCliExecForTests(null);
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = previousBin;
  });

  it('вызывает agent -p --trust --workspace с подменённым exec', async () => {
    const calls: Array<{ binary: string; args: string[]; prompt: string }> = [];
    setCursorCliExecForTests(async (input) => {
      calls.push({
        binary: input.binary,
        args: input.args,
        prompt: input.prompt,
      });
      return { stdout: 'Ответ CLI для теста.', stderr: '', code: 0 };
    });
    const result = await runCursorCliStep({
      token: '',
      task: 'Добавить README',
      stepTitle: 'Сборка',
      agentName: 'Сборщик',
      instructions: 'Собери по плану.',
      skills: [],
      projectFolder: directory,
      workspaceFile: null,
    });
    expect(result.text).toContain('CLI');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['-p', '--trust', '--workspace', directory]);
    expect(calls[0]?.prompt).toContain('README');
  });

  it('без CLI объясняет причину по-русски', async () => {
    delete process.env.CURSOR_AGENT_BIN;
    await expect(
      runCursorCliStep({
        token: '',
        task: 'x',
        stepTitle: 'y',
        agentName: 'z',
        instructions: '',
        skills: [],
        projectFolder: directory,
        workspaceFile: null,
      }),
    ).rejects.toThrow('agent');
  });

  it('resolveAgentBinary находит бинарник из CURSOR_AGENT_BIN', () => {
    expect(resolveAgentBinary()).toContain('fake-agent');
  });
});
