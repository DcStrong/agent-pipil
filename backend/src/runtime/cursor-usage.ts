/** Снимок расхода задачи/запуска для хранения и UI. */
export interface TaskUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** null — `agent.getUsage()` ещё не отдал цену. */
  chargedCents: number | null;
}

export interface RunUsageState {
  /** true, если хотя бы один шаг Cursor сообщил токены. */
  known: boolean;
  totals: TaskUsageTotals | null;
}

export interface RunCursorUsageStep {
  stepId: string;
  title: string;
  agentName: string;
  totals: TaskUsageTotals | null;
  sources: Array<'run.usage' | 'agent.getUsage' | 'cli-output'>;
}

export type CursorStepUsageCapture = {
  runUsage: UsageTokenFields | null;
  billedUsage: UsageTokenFields | null;
  chargedCents: number | null;
  sources: RunCursorUsageStep['sources'];
};

type UsageTokenFields = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

export function pickStepTokenFields(
  capture: CursorStepUsageCapture,
): UsageTokenFields | null {
  return capture.billedUsage ?? capture.runUsage ?? null;
}

export function toTaskUsageTotals(
  tokens: UsageTokenFields,
  chargedCents: number | null,
): TaskUsageTotals {
  return {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.totalTokens,
    chargedCents,
  };
}

export function emptyRunUsageState(): RunUsageState {
  return { known: false, totals: null };
}

export function mergeRunUsageState(
  current: RunUsageState | undefined,
  stepTotals: TaskUsageTotals | null,
): RunUsageState {
  if (!stepTotals) {
    return current ?? emptyRunUsageState();
  }
  if (!current?.known || !current.totals) {
    return { known: true, totals: { ...stepTotals } };
  }
  const charged =
    stepTotals.chargedCents === null && current.totals.chargedCents === null
      ? null
      : (current.totals.chargedCents ?? 0) + (stepTotals.chargedCents ?? 0);
  return {
    known: true,
    totals: {
      inputTokens: current.totals.inputTokens + stepTotals.inputTokens,
      outputTokens: current.totals.outputTokens + stepTotals.outputTokens,
      cacheReadTokens:
        current.totals.cacheReadTokens + stepTotals.cacheReadTokens,
      cacheWriteTokens:
        current.totals.cacheWriteTokens + stepTotals.cacheWriteTokens,
      totalTokens: current.totals.totalTokens + stepTotals.totalTokens,
      chargedCents: charged,
    },
  };
}

export function recordCursorStepUsage(
  run: {
    usage?: RunUsageState;
    usageSteps?: RunCursorUsageStep[];
  },
  step: { stepId: string; title: string; agentName: string },
  capture: CursorStepUsageCapture,
): void {
  const tokens = pickStepTokenFields(capture);
  const stepTotals = tokens
    ? toTaskUsageTotals(tokens, capture.chargedCents)
    : null;
  if (!run.usageSteps) run.usageSteps = [];
  run.usageSteps.push({
    stepId: step.stepId,
    title: step.title,
    agentName: step.agentName,
    totals: stepTotals,
    sources: capture.sources,
  });
  run.usage = mergeRunUsageState(run.usage, stepTotals);
}
