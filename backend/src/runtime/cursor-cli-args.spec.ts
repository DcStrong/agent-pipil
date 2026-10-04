import { buildAgentCliArgs, setAgentHelpTextForTests } from './cursor-cli-args';

describe('buildAgentCliArgs', () => {
  afterEach(() => {
    setAgentHelpTextForTests(null);
  });

  it('добавляет --trust и --resume, если help их описывает', () => {
    setAgentHelpTextForTests(`
      -p, --print
      --workspace <path>
      --trust   Trust the workspace
      --resume [chatId]
    `);
    expect(
      buildAgentCliArgs('/bin/agent', {
        workspace: '/proj',
        resumeChatId: 'run-abc-123',
      }),
    ).toEqual(['-p', '--workspace', '/proj', '--trust', '--resume', 'run-abc-123']);
  });

  it('без help не добавляет необязательные флаги', () => {
    setAgentHelpTextForTests('');
    expect(buildAgentCliArgs('/bin/agent', { workspace: '/proj' })).toEqual([
      '-p',
      '--workspace',
      '/proj',
    ]);
  });
});
