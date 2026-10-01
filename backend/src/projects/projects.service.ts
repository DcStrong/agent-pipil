import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SavedProject, SavedProjectKind } from '../domain';
import {
  displayName,
  projectRootForRun,
  validateProjectPath,
} from '../runtime/saved-project';
import { inspectProject } from '../runtime/project-folder';
import { StoreService } from '../store/store.service';

export interface SavedProjectView extends SavedProject {
  label: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly store: StoreService) {}

  list(): SavedProjectView[] {
    return this.store.read().projects.map((item) => this.view(item));
  }

  get(id: string): SavedProjectView {
    const found = this.store.read().projects.find((item) => item.id === id);
    if (!found) throw new NotFoundException('Проект не найден.');
    return this.view(found);
  }

  add(kind: SavedProjectKind, rawPath: string): SavedProjectView {
    let parsed: { path: string; folderName: string };
    try {
      parsed = validateProjectPath(kind, rawPath);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Путь проекта не подходит.',
      );
    }
    const duplicate = this.store
      .read()
      .projects.some(
        (item) => item.kind === kind && item.path === parsed.path,
      );
    if (duplicate) {
      throw new BadRequestException('Такой путь уже есть в списке.');
    }
    const project: SavedProject = {
      id: randomUUID(),
      kind,
      path: parsed.path,
      folderName: parsed.folderName,
      alias: '',
    };
    this.store.mutate((state) => {
      state.projects.push(project);
    });
    return this.view(project);
  }

  updateAlias(id: string, alias: string): SavedProjectView {
    const trimmed = alias.trim();
    if (trimmed.length > 120) {
      throw new BadRequestException('Алиас короче 120 символов.');
    }
    let updated: SavedProject | null = null;
    this.store.mutate((state) => {
      const index = state.projects.findIndex((item) => item.id === id);
      if (index === -1) return;
      state.projects[index] = {
        ...state.projects[index],
        alias: trimmed,
      };
      updated = state.projects[index];
    });
    if (!updated) throw new NotFoundException('Проект не найден.');
    return this.view(updated);
  }

  remove(id: string): { ok: true } {
    let removed = false;
    this.store.mutate((state) => {
      const before = state.projects.length;
      state.projects = state.projects.filter((item) => item.id !== id);
      removed = state.projects.length < before;
    });
    if (!removed) throw new NotFoundException('Проект не найден.');
    return { ok: true };
  }

  /** Снимок папки для запуска по сохранённому проекту или workspace. */
  snapshotForRun(
    projectId: string | null | undefined,
    fallbackPath: string | null,
    mapPath: string | null,
  ): {
    project: ReturnType<typeof inspectProject>;
    folder: string | null;
    workspaceFile: string | null;
  } {
    if (projectId) {
      const saved = this.store.read().projects.find((item) => item.id === projectId);
      if (!saved) throw new BadRequestException('Выбранный проект не найден.');
      const root = projectRootForRun(saved);
      return {
        project: inspectProject(root, mapPath),
        folder: root,
        workspaceFile: saved.kind === 'workspace' ? saved.path : null,
      };
    }
    return {
      project: inspectProject(fallbackPath, mapPath),
      folder: fallbackPath,
      workspaceFile: null,
    };
  }

  private view(project: SavedProject): SavedProjectView {
    return { ...project, label: displayName(project) };
  }
}
