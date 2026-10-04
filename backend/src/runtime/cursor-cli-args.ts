/**
 * Флаги локального `agent`, которые зависят от версии CLI.
 * В тестах подменяется через setAgentHelpTextForTests.
 */
import { execFileSync } from 'node:child_process';

let helpCache: { binary: string; text: string } | null = null;
let helpTextForTests: string | null = null;

/** Только unit-tests: не запускает настоящий agent --help. */
export function setAgentHelpTextForTests(text: string | null): void {
  helpTextForTests = text;
  helpCache = null;
}

export function resetAgentCliHelpCache(): void {
  helpCache = null;
}

function readAgentHelp(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (helpTextForTests !== null) return helpTextForTests;
  if (helpCache?.binary === binary) return helpCache.text;
  try {
    const text = execFileSync(binary, ['--help'], {
      encoding: 'utf8',
      timeout: 8_000,
      env,
    });
    helpCache = { binary, text };
    return text;
  } catch {
    helpCache = { binary, text: '' };
    return '';
  }
}

export type AgentCliInvocationOptions = {
  workspace: string;
  resumeChatId?: string | null;
};

/** Базовые аргументы перед промптом: print, workspace, trust и resume по возможности. */
export function buildAgentCliArgs(
  binary: string,
  options: AgentCliInvocationOptions,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const args = ['-p', '--workspace', options.workspace];
  const help = readAgentHelp(binary, env);
  if (help.includes('--trust')) {
    args.push('--trust');
  }
  const resumeId = options.resumeChatId?.trim();
  if (resumeId && help.includes('--resume')) {
    args.push('--resume', resumeId);
  }
  return args;
}
