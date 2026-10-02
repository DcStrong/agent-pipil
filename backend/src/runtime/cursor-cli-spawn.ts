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
    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      onChunk?.('stdout', text);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      onChunk?.('stderr', text);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Превышено время ожидания команды Cursor CLI.'));
    }, input.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
