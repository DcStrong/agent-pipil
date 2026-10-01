import { Test, type TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StoreService } from '../store/store.service';
import { DATA_PATH } from '../store/store.tokens';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let directory = '';
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.get(StoreService).whenSaved();
      await moduleRef.close();
      moduleRef = undefined;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function make(): Promise<ProjectsService> {
    directory = await mkdtemp(join(tmpdir(), 'pipil-projects-'));
    moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        StoreService,
        { provide: DATA_PATH, useValue: join(directory, 'state.json') },
      ],
    }).compile();
    return moduleRef.get(ProjectsService);
  }

  it('добавляет папку, алиас и удаляет запись', async () => {
    const service = await make();
    const folder = directory;
    const added = service.add('folder', folder);
    expect(added.folderName).toBeTruthy();
    expect(added.label).toBe(added.folderName);
    const renamed = service.updateAlias(added.id, 'Локальный');
    expect(renamed.label).toBe('Локальный');
    expect(service.list()).toHaveLength(1);
    expect(service.remove(added.id)).toEqual({ ok: true });
    expect(service.list()).toHaveLength(0);
  });
});
