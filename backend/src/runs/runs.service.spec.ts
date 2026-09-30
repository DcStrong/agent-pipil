import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_RUNTIME, type AgentRuntime } from '../agents/agent-runtime';
import { SimulatedAgent } from '../agents/simulated-agent';
import { PipelineRunner } from '../pipeline/pipeline-runner';
import { SkillsService } from '../skills/skills.service';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { RunsService } from './runs.service';

async function settle(): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('RunsService', () => {
  let directory = '';
  let moduleRef: TestingModule | undefined;
  const previousDelay = process.env.SIM_DELAY_MS;

  beforeAll(() => {
    process.env.SIM_DELAY_MS = '0';
  });

  afterAll(() => {
    if (previousDelay === undefined) delete process.env.SIM_DELAY_MS;
    else process.env.SIM_DELAY_MS = previousDelay;
  });

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.get(StoreService).whenSaved();
      await moduleRef.close();
      moduleRef = undefined;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function service(): Promise<{
    runs: RunsService;
    skills: SkillsService;
  }> {
    directory = await mkdtemp(join(tmpdir(), 'pipil-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        RunsService,
        SkillsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
        { provide: AGENT_RUNTIME, useClass: SimulatedAgent },
        {
          provide: PipelineRunner,
          useFactory: (runtime: AgentRuntime) => new PipelineRunner(runtime),
          inject: [AGENT_RUNTIME],
        },
      ],
    }).compile();
    return {
      runs: moduleRef.get(RunsService),
      skills: moduleRef.get(SkillsService),
    };
  }

  it('gives each role the shared skills and only its own role skills', async () => {
    const { runs, skills } = await service();
    skills.create(
      'Reset checklist',
      'Mention the reset path.',
      'role',
      'role_analyst',
    );

    const started = runs.start('Add a password reset flow');
    expect(started.status).toBe('running');
    expect(started.ownerName).toBe('Analyst');
    expect(() => runs.start('Another task')).toThrow(ConflictException);

    await settle();
    const finished = runs.get(started.id);
    expect(finished.status).toBe('completed');
    expect(finished.ownerName).toBeNull();
    expect(finished.finalResult).toContain('Add a password reset flow');
    expect(finished.work.map((item) => item.roleName)).toEqual([
      'Analyst',
      'Architect',
      'Developer',
      'Reviewer',
    ]);

    const analyst = finished.stages[0]?.skills.map((skill) => skill.name);
    const developer = finished.stages[2]?.skills.map((skill) => skill.name);
    expect(analyst).toEqual(
      expect.arrayContaining(['Stay in scope', 'Reset checklist']),
    );
    expect(developer).toContain('Stay in scope');
    expect(developer).not.toContain('Reset checklist');
    expect(developer).toContain('Name the changes');
  });
});
