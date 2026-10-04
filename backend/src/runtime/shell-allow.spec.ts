import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  holdSessionShellAllows,
  persistShellAllow,
  projectAllowsShell,
  removeShellAllow,
  shellCommandBase,
} from './shell-allow';

describe('shell-allow', () => {
  let folder = '';

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'pipil-shell-'));
  });

  afterEach(async () => {
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it('берёт первое слово и дописывает Shell() в cli.json', async () => {
    expect(shellCommandBase('node .lint-check.mjs 2>&1 | tail -20')).toBe('node');
    persistShellAllow(folder, 'node');
    expect(projectAllowsShell(folder, 'node')).toBe(true);
    const raw = await readFile(join(folder, '.cursor', 'cli.json'), 'utf8');
    expect(raw).toContain('Shell(node)');
    removeShellAllow(folder, 'node');
    expect(projectAllowsShell(folder, 'node')).toBe(false);
  });

  it('временное разрешение снимается после процесса', () => {
    const release = holdSessionShellAllows(folder, ['pwd']);
    expect(projectAllowsShell(folder, 'pwd')).toBe(true);
    release();
    expect(projectAllowsShell(folder, 'pwd')).toBe(false);
  });
});