import type { AgentContext } from '../domain';
import { ModelAgent } from './model-agent';

function readRequestBody(body: RequestInit['body']): {
  model: string;
  messages: Array<{ role: string; content: string }>;
} {
  if (typeof body !== 'string')
    throw new Error('Expected a JSON request body.');
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected a JSON object.');
  }
  const record = parsed as {
    model?: unknown;
    messages?: Array<{ role?: unknown; content?: unknown }>;
  };
  if (typeof record.model !== 'string' || !Array.isArray(record.messages)) {
    throw new Error('Expected model messages.');
  }
  return {
    model: record.model,
    messages: record.messages.map((message) => ({
      role: typeof message.role === 'string' ? message.role : '',
      content: typeof message.content === 'string' ? message.content : '',
    })),
  };
}

const context: AgentContext = {
  roleName: 'Analyst',
  systemPrompt: 'You are the analyst.',
  skills: [
    { name: 'Stay in scope', instructions: 'Only the task.', scope: 'shared' },
  ],
  task: 'Add a password reset flow',
  priorWork: [],
  incomingHandoff: null,
  outgoingHandoff: 'Pass the problem forward.',
  isFinalStage: true,
};

describe('ModelAgent', () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('sends the role prompt and returns the model text', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requestedInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '## Final result\nReady to ship.' } },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    };

    const agent = new ModelAgent({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1/',
      model: 'test-model',
    });
    const turn = await agent.complete(context);

    expect(turn.output).toContain('Final result');
    expect(turn.summary).toContain('Ready to ship.');
    expect(requestedUrl).toBe('https://example.test/v1/chat/completions');
    const headers = requestedInit?.headers;
    if (!headers || headers instanceof Headers || Array.isArray(headers)) {
      throw new Error('Expected a header record.');
    }
    expect(headers.Authorization).toBe('Bearer test-key');
    const body = readRequestBody(requestedInit?.body);
    expect(body.model).toBe('test-model');
    expect(body.messages[0]?.content).toContain('You are the analyst.');
    expect(body.messages[0]?.content).toContain('Stay in scope');
    expect(body.messages[1]?.content).toContain('Add a password reset flow');
  });

  it('fails clearly when the model request is rejected', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const agent = new ModelAgent({
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
    });
    await expect(agent.complete(context)).rejects.toThrow('bad key');
  });
});
