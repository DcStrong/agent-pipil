import { spawn } from 'node:child_process';

export type AgentSpawnInput = {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void;
};

export type AgentSpawnResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type AgentSpawnFn = (input: AgentSpawnInput) => Promise<AgentSpawnResult>;

export function spawnAgentProcess(input: AgentSpawnInput): Promise<AgentSpawnResult> {
  const onChunk = input.onChunk;
  return new Promise((resolve, reject) => {
    const child = spawn(input.binary, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error: unknown, result?: AgentSpawnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else if (result) resolve(result);
    };
    const take = (stream: 'stdout' | 'stderr', text: string) => {
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      try {
        onChunk?.(stream, text);
      } catch (error) {
        child.kill('SIGTERM');
        finish(error);
      }
    };
    child.stdout?.on('data', (chunk: Buffer | string) => {
      take('stdout', chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      take('stderr', chunk.toString());
    });
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Превышено время ожидания команды Cursor CLI.'));
    }, input.timeoutMs);
    child.on('error', (error) => {
      finish(error);
    });
    child.on('close', (code) => {
      finish(null, { stdout, stderr, code });
    });
  });
}
