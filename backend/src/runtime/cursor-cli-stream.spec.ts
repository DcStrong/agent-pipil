import { CliStreamDecoder } from './cursor-cli-stream';

describe('CliStreamDecoder', () => {
  it('достаёт текст, чтение файла и итоговый result', () => {
    const traces: string[] = [];
    const decoder = new CliStreamDecoder();
    const raw = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Смотрю исходники.' }] },
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: { readToolCall: { args: { path: 'src/app.ts' } } },
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        tool_call: { readToolCall: { args: { path: 'src/app.ts' } } },
      }),
      JSON.stringify({ type: 'result', result: 'Готовый ответ.' }),
      '{"битый"',
    ].join('\n');
    decoder.push(raw, (trace) => traces.push(trace.text));
    decoder.finish(() => undefined);
    expect(traces).toEqual(['Смотрю исходники.', 'Читает src/app.ts']);
    expect(decoder.finalText(raw)).toBe('Готовый ответ.');
  });

  it('достаёт полную shell-команду', () => {
    const decoder = new CliStreamDecoder();
    const seen: string[] = [];
    const raw = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: {
        shellToolCall: {
          args: { command: 'node .lint-check.mjs 2>&1 | tail -20' },
        },
      },
    });
    expect(() =>
      decoder.push(
        `${raw}\n`,
        () => undefined,
        (command) => {
          seen.push(command);
          throw new Error('stop');
        },
      ),
    ).toThrow('stop');
    expect(seen).toEqual(['node .lint-check.mjs 2>&1 | tail -20']);
  });

  it('отдаёт session_id сразу, не дожидаясь конца потока', () => {
    const decoder = new CliStreamDecoder();
    const seen: string[] = [];
    decoder.push(
      `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' })}\n`,
      () => undefined,
      undefined,
      (id) => seen.push(id),
    );
    expect(seen).toEqual(['sess-1']);
    expect(decoder.sessionId()).toBe('sess-1');
    decoder.finish(() => undefined);
  });

  it('обычный текст без JSON остаётся ответом шага', () => {
    const decoder = new CliStreamDecoder();
    decoder.push('Ответ локального CLI.\n', () => undefined);
    decoder.finish(() => undefined);
    expect(decoder.finalText('Ответ локального CLI.')).toBe(
      'Ответ локального CLI.',
    );
  });
});
