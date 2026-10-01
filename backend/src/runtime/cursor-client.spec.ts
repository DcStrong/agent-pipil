import { CursorClient } from './cursor-client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('CursorClient', () => {
  it('создаёт агента и ждёт ответ, когда fetch подменён', async () => {
    const calls: string[] = [];
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/v1/agents') && init?.method === 'POST') {
        return jsonResponse(
          {
            agent: { id: 'bc-test-agent', url: 'https://cursor.com/agents/bc-test-agent' },
            run: { id: 'run-test-1' },
          },
          201,
        );
      }
      if (url.includes('/runs/run-test-1')) {
        return jsonResponse({
          status: 'FINISHED',
          result: 'Готово: README добавлен.',
        });
      }
      return jsonResponse({ error: { message: 'неожиданный запрос' } }, 404);
    });
    const client = new CursorClient(fetchMock as typeof fetch, 'https://api.cursor.com');
    const result = await client.runStep({
      token: 'secret_token_value',
      task: 'Добавить README',
      stepTitle: 'Сборка',
      agentName: 'Сборщик',
      instructions: 'Собери по плану.',
      skills: [],
      projectFolder: '/tmp/demo',
      workspaceFile: null,
    });
    expect(result.text).toContain('README');
    expect(result.agentId).toBe('bc-test-agent');
    expect(calls.some((line) => line.startsWith('POST'))).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('без токена объясняет причину по-русски', async () => {
    const client = new CursorClient(jest.fn() as typeof fetch);
    await expect(
      client.runStep({
        token: 'short',
        task: 'x',
        stepTitle: 'y',
        agentName: 'z',
        instructions: '',
        skills: [],
        projectFolder: null,
        workspaceFile: null,
      }),
    ).rejects.toThrow('токен');
  });

  it('пробрасывает ошибку Cursor из ответа API', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ error: { message: 'invalid_api_key' } }, 401),
    );
    const client = new CursorClient(fetchMock as typeof fetch);
    await expect(
      client.runStep({
        token: 'valid_token_here',
        task: 'x',
        stepTitle: 'y',
        agentName: 'z',
        instructions: '',
        skills: [],
        projectFolder: null,
        workspaceFile: null,
      }),
    ).rejects.toThrow('invalid_api_key');
  });

  it('liveEnabled выключен только при CURSOR_LIVE=0', () => {
    const client = new CursorClient();
    expect(client.liveEnabled({})).toBe(true);
    expect(client.liveEnabled({ CURSOR_LIVE: '0' })).toBe(false);
  });
});
