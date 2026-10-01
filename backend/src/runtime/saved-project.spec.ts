import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultFolderName,
  displayName,
  projectRootForRun,
  validateProjectPath,
} from './saved-project';
import type { SavedProject } from '../domain';

describe('saved-project', () => {
  it('берёт имя папки и алиас для отображения', () => {
    const project: SavedProject = {
      id: '1',
      kind: 'folder',
      path: '/tmp/my-app',
      folderName: 'my-app',
      alias: '',
    };
    expect(displayName(project)).toBe('my-app');
    expect(displayName({ ...project, alias: 'Мой сервис' })).toBe('Мой сервис');
  });

  it('имя workspace — имя файла без расширения', () => {
    expect(defaultFolderName('workspace', '/x/demo.code-workspace')).toBe('demo');
  });

  it('читает первую папку из .code-workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipil-ws-'));
    const nested = join(root, 'pkg');
    mkdirSync(nested, { recursive: true });
    const workspace = join(root, 'team.code-workspace');
    writeFileSync(
      workspace,
      JSON.stringify({ folders: [{ path: 'pkg' }] }),
    );
    const project: SavedProject = {
      id: 'w',
      kind: 'workspace',
      path: workspace,
      folderName: 'team',
      alias: '',
    };
    expect(projectRootForRun(project)).toBe(nested);
    expect(validateProjectPath('folder', nested).folderName).toBe('pkg');
  });
});
