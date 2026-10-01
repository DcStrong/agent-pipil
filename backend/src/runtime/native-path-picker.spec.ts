import {
  kdialogArgs,
  pickNativePath,
  zenityArgs,
} from './native-path-picker';

describe('native-path-picker', () => {
  it('zenity: папка и workspace', () => {
    expect(zenityArgs('folder')).toEqual([
      '--file-selection',
      '--directory',
      '--title=Выберите папку проекта',
    ]);
    expect(zenityArgs('workspace')).toEqual([
      '--file-selection',
      '--file-filter=Workspace | *.code-workspace',
      '--title=Выберите файл .code-workspace',
    ]);
  });

  it('kdialog: папка и workspace', () => {
    expect(kdialogArgs('folder')[0]).toBe('--getexistingdirectory');
    expect(kdialogArgs('workspace')).toContain('*.code-workspace');
  });

  it('отмена диалога', async () => {
    const outcome = await pickNativePath('folder', async () => ({
      code: 1,
      stdout: '',
      stderr: '',
    }));
    expect(outcome).toEqual({ cancelled: true });
  });

  it('возвращает путь', async () => {
    const outcome = await pickNativePath('workspace', async () => ({
      code: 0,
      stdout: '/tmp/team.code-workspace\n',
      stderr: '',
    }));
    expect(outcome).toEqual({
      cancelled: false,
      path: '/tmp/team.code-workspace',
    });
  });
});
