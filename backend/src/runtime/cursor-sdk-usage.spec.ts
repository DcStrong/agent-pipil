import {
  fetchCliCursorStepUsage,
  fetchCloudCursorStepUsage,
  setCursorSdkUsageForTests,
} from './cursor-sdk-usage';

afterEach(() => {
  setCursorSdkUsageForTests(null);
});

describe('fetchCloudCursorStepUsage', () => {
  it('складывает run.usage и agent.getUsage из SDK', async () => {
    setCursorSdkUsageForTests({
      getRun: async () => ({
        wait: async () => ({
          usage: {
            inputTokens: 50,
            outputTokens: 20,
            cacheReadTokens: 1,
            cacheWriteTokens: 0,
            totalTokens: 71,
          },
        }),
      }),
      getUsage: async () => ({
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          totalTokens: 71,
        },
        cost: { rawCostCents: 12, chargedCents: 10 },
        runs: [
          {
            runId: 'run-abc',
            usage: {
              inputTokens: 50,
              outputTokens: 20,
              cacheReadTokens: 1,
              cacheWriteTokens: 0,
              totalTokens: 71,
            },
            cost: { rawCostCents: 12, chargedCents: 10 },
          },
        ],
      }),
    });
    const capture = await fetchCloudCursorStepUsage(
      'bc-agent',
      'run-abc',
      'key',
    );
    expect(capture.sources).toContain('run.usage');
    expect(capture.sources).toContain('agent.getUsage');
    expect(capture.chargedCents).toBe(10);
    expect(capture.billedUsage?.totalTokens).toBe(71);
  });
});

describe('fetchCliCursorStepUsage', () => {
  it('не зовёт getUsage для заглушки local-cli', async () => {
    const getUsage = jest.fn();
    setCursorSdkUsageForTests({ getUsage });
    const capture = await fetchCliCursorStepUsage('ответ', '', 'key');
    expect(getUsage).not.toHaveBeenCalled();
    expect(capture.sources).toEqual([]);
  });

  it('зовёт getUsage, если CLI напечатал agent id', async () => {
    setCursorSdkUsageForTests({
      getUsage: async () => ({
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 3,
        },
        runs: [],
      }),
    });
    const stderr = 'started agent-agent-12345678-1234-1234-1234-123456789abc';
    const capture = await fetchCliCursorStepUsage('', stderr, 'key');
    expect(capture.sources).toContain('agent.getUsage');
    expect(capture.billedUsage?.totalTokens).toBe(3);
  });
});
