import {
  buildCliUsageCapture,
  parseTokenUsageFromCliOutput,
} from './cursor-cli-usage-parse';

describe('parseTokenUsageFromCliOutput', () => {
  it('читает JSON строку с полями TokenUsage', () => {
    const line = JSON.stringify({
      inputTokens: 100,
      outputTokens: 40,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
      totalTokens: 147,
    });
    expect(parseTokenUsageFromCliOutput(line)?.totalTokens).toBe(147);
  });

  it('возвращает null без токенов', () => {
    expect(parseTokenUsageFromCliOutput('просто текст')).toBeNull();
  });
});

describe('buildCliUsageCapture', () => {
  it('помечает источник cli-output', () => {
    const stdout = JSON.stringify({
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
      },
    });
    const capture = buildCliUsageCapture(stdout, '');
    expect(capture.sources).toEqual(['cli-output']);
    expect(capture.runUsage?.totalTokens).toBe(15);
  });
});
