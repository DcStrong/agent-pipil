/**
 * Официальный Cursor TypeScript SDK: `run.usage` и `Agent.getUsage()`.
 * Сеть подменяется в тестах через setCursorSdkUsageForTests.
 */
import type { AgentUsage, TokenUsage } from '@cursor/sdk';
import type { CursorStepUsageCapture } from './cursor-usage';
import {
  buildCliUsageCapture,
  parseAgentIdFromCliOutput,
  parseRunIdFromCliOutput,
} from './cursor-cli-usage-parse';

export type SdkGetUsageFn = (
  agentId: string,
  options: { runId?: string; apiKey?: string },
) => Promise<AgentUsage>;

export type SdkGetRunFn = (
  runId: string,
  options: { runtime: 'cloud'; agentId: string; apiKey?: string },
) => Promise<{
  wait: () => Promise<{ usage?: TokenUsage }>;
}>;

type SdkUsageHooks = {
  getUsage?: SdkGetUsageFn;
  getRun?: SdkGetRunFn;
};

let hooksForTests: SdkUsageHooks | null = null;

/** Только unit-тесты: не тянет настоящий SDK. */
export function setCursorSdkUsageForTests(hooks: SdkUsageHooks | null): void {
  hooksForTests = hooks;
}

async function loadSdk(): Promise<{ Agent: typeof import('@cursor/sdk').Agent }> {
  const sdk = (await import('@cursor/sdk')) as {
    Agent: typeof import('@cursor/sdk').Agent;
  };
  return sdk;
}

function mapUsage(usage: TokenUsage | undefined): CursorStepUsageCapture['runUsage'] {
  if (!usage || usage.totalTokens <= 0) return null;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
  };
}

function chargedFromAgentUsage(billed: AgentUsage): number | null {
  if (billed.cost) return billed.cost.chargedCents;
  const first = billed.runs.find((run) => run.cost);
  return first?.cost?.chargedCents ?? null;
}

async function fetchBilledUsage(
  agentId: string,
  runId: string | undefined,
  apiKey: string,
): Promise<Pick<CursorStepUsageCapture, 'billedUsage' | 'chargedCents'>> {
  const getUsage =
    hooksForTests?.getUsage ??
    (async (id, options) => {
      const { Agent } = await loadSdk();
      return Agent.getUsage(id, options);
    });
  const billed = await getUsage(agentId, { runId, apiKey });
  return {
    billedUsage: mapUsage(billed.usage),
    chargedCents: chargedFromAgentUsage(billed),
  };
}

/** Cloud Agents: `Agent.getRun` → `run.wait().usage` и `Agent.getUsage`. */
export async function fetchCloudCursorStepUsage(
  agentId: string,
  runId: string,
  apiKey: string,
): Promise<CursorStepUsageCapture> {
  const sources: CursorStepUsageCapture['sources'] = [];
  let runUsage: CursorStepUsageCapture['runUsage'] = null;
  try {
    const getRun =
      hooksForTests?.getRun ??
      (async (id, options) => {
        const { Agent } = await loadSdk();
        return Agent.getRun(id, options);
      });
    const sdkRun = await getRun(runId, {
      runtime: 'cloud',
      agentId,
      apiKey,
    });
    const result = await sdkRun.wait();
    runUsage = mapUsage(result.usage);
    if (runUsage) sources.push('run.usage');
  } catch {
    // Без run.usage остаётся только billed.
  }
  try {
    const billed = await fetchBilledUsage(agentId, runId, apiKey);
    if (billed.billedUsage) sources.push('agent.getUsage');
    return {
      runUsage,
      billedUsage: billed.billedUsage,
      chargedCents: billed.chargedCents,
      sources,
    };
  } catch {
    return {
      runUsage,
      billedUsage: null,
      chargedCents: null,
      sources,
    };
  }
}

/**
 * Локальный CLI: usage из вывода процесса; `getUsage()` — только если CLI
 * напечатал настоящий `agent-…` id (заглушки `local-cli` SDK не принимает).
 */
export async function fetchCliCursorStepUsage(
  stdout: string,
  stderr: string,
  apiKey: string | null | undefined,
): Promise<CursorStepUsageCapture> {
  const base = buildCliUsageCapture(stdout, stderr);
  const blob = `${stdout}\n${stderr}`;
  const agentId = parseAgentIdFromCliOutput(blob);
  const runId = parseRunIdFromCliOutput(blob);
  const key = apiKey?.trim();
  if (!agentId || !key || agentId === 'local-cli') {
    return base;
  }
  try {
    const billed = await fetchBilledUsage(agentId, runId ?? undefined, key);
    const sources = [...base.sources];
    if (billed.billedUsage && !sources.includes('agent.getUsage')) {
      sources.push('agent.getUsage');
    }
    return {
      runUsage: base.runUsage,
      billedUsage: billed.billedUsage ?? base.billedUsage,
      chargedCents: billed.chargedCents,
      sources,
    };
  } catch {
    return base;
  }
}
