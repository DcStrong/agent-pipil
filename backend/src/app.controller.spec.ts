import { Test } from '@nestjs/testing';
import { AGENT_RUNTIME } from './agents/agent-runtime';
import { AppController } from './app.controller';

describe('AppController', () => {
  it('reports the simulated agent mode', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AGENT_RUNTIME,
          useValue: { mode: 'simulated', complete: () => Promise.resolve({}) },
        },
      ],
    }).compile();

    const controller = moduleRef.get(AppController);
    expect(controller.health()).toEqual({ ok: true, agentMode: 'simulated' });
  });
});
