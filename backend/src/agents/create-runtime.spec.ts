import { createRuntime } from './create-runtime';

describe('createRuntime', () => {
  it('simulates when no key is set', () => {
    expect(createRuntime({}).mode).toBe('simulated');
  });

  it('uses a model when a key is set', () => {
    expect(createRuntime({ MODEL_API_KEY: 'test-key' }).mode).toBe('model');
  });

  it('stays simulated when that mode is forced', () => {
    expect(
      createRuntime({ MODEL_API_KEY: 'test-key', AGENT_MODE: 'simulated' })
        .mode,
    ).toBe('simulated');
  });

  it('refuses model mode without a key', () => {
    expect(() => createRuntime({ AGENT_MODE: 'model' })).toThrow(
      'MODEL_API_KEY',
    );
  });
});
