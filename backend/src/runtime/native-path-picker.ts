import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { SavedProjectKind } from '../domain';

export type PickPathOutcome =
  | { cancelled: true }
  | { cancelled: false; path: string };

export type DialogRunner = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultRunner: DialogRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export function zenityArgs(kind: SavedProjectKind): string[] {
  const title =
    kind === 'folder'
      ? 'Выберите папку проекта'
      : 'Выберите файл .code-workspace';
  if (kind === 'folder') {
    return ['--file-selection', '--directory', `--title=${title}`];
  }
  return [
    '--file-selection',
    '--file-filter=Workspace | *.code-workspace',
    `--title=${title}`,
  ];
}

export function kdialogArgs(kind: SavedProjectKind): string[] {
  if (kind === 'folder') {
    return ['--getexistingdirectory', '.', '--title', 'Выберите папку проекта'];
  }
  return [
    '--getopenfilename',
    '.',
    '*.code-workspace',
    '--title',
    'Выберите файл .code-workspace',
  ];
}

function macScript(kind: SavedProjectKind): string {
  const prompt =
    kind === 'folder'
      ? 'Выберите папку проекта'
      : 'Выберите файл .code-workspace';
  if (kind === 'folder') {
    return `POSIX path of (choose folder with prompt "${prompt}")`;
  }
  return `POSIX path of (choose file of type {"code-workspace"} with prompt "${prompt}")`;
}

function windowsScript(kind: SavedProjectKind): string {
  if (kind === 'folder') {
    return `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Выберите папку проекта'
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
`.trim();
  }
  return `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Filter = 'Workspace (*.code-workspace)|*.code-workspace'
$d.Title = 'Выберите файл .code-workspace'
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }
`.trim();
}

async function pickWithZenity(
  kind: SavedProjectKind,
  runner: DialogRunner,
): Promise<PickPathOutcome> {
  const { code, stdout } = await runner('zenity', zenityArgs(kind));
  if (code !== 0) return { cancelled: true };
  const path = stdout.trim();
  return path ? { cancelled: false, path } : { cancelled: true };
}

async function pickWithKdialog(
  kind: SavedProjectKind,
  runner: DialogRunner,
): Promise<PickPathOutcome> {
  const { code, stdout } = await runner('kdialog', kdialogArgs(kind));
  if (code !== 0) return { cancelled: true };
  const path = stdout.trim();
  return path ? { cancelled: false, path } : { cancelled: true };
}

async function pickWithOsascript(
  kind: SavedProjectKind,
  runner: DialogRunner,
): Promise<PickPathOutcome> {
  const { code, stdout } = await runner('osascript', ['-e', macScript(kind)]);
  if (code !== 0) return { cancelled: true };
  const path = stdout.trim();
  return path ? { cancelled: false, path } : { cancelled: true };
}

async function pickWithPowerShell(
  kind: SavedProjectKind,
  runner: DialogRunner,
): Promise<PickPathOutcome> {
  const { code, stdout } = await runner('powershell', [
    '-NoProfile',
    '-Command',
    windowsScript(kind),
  ]);
  if (code !== 0) return { cancelled: true };
  const path = stdout.trim();
  return path ? { cancelled: false, path } : { cancelled: true };
}

export class NativePathPickerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativePathPickerUnavailable';
  }
}

/** Диалог выбора пути на машине, где работает backend. */
export async function pickNativePath(
  kind: SavedProjectKind,
  runner: DialogRunner = defaultRunner,
): Promise<PickPathOutcome> {
  const os = platform();
  if (os === 'darwin') {
    return pickWithOsascript(kind, runner);
  }
  if (os === 'win32') {
    return pickWithPowerShell(kind, runner);
  }
  if (os === 'linux') {
    try {
      return await pickWithZenity(kind, runner);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (!message.includes('ENOENT')) throw reason;
      try {
        return await pickWithKdialog(kind, runner);
      } catch (inner) {
        const innerMessage =
          inner instanceof Error ? inner.message : String(inner);
        if (innerMessage.includes('ENOENT')) {
          throw new NativePathPickerUnavailable(
            'На этой машине не найден zenity или kdialog — укажите путь вручную.',
          );
        }
        throw inner;
      }
    }
  }
  throw new NativePathPickerUnavailable(
    'Выбор папки через диалог на этой ОС пока не поддерживается — укажите путь вручную.',
  );
}
