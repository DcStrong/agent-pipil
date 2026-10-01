import { CursorClient } from './cursor-client';

describe('CursorClient', () => {
  it('не ходит в сеть, даже если его попросили выполнить шаг', async () => {
    const original = globalThis.fetch;
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const client = new CursorClient();
      await expect(client.runStep()).rejects.toThrow('имитац');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(client.liveEnabled({})).toBe(false);
      expect(client.liveEnabled({ CURSOR_LIVE: '1' })).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
