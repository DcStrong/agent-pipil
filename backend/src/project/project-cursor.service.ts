/** Тонкая оболочка над файлами .cursor. Сетевой вызов Cursor здесь не делается. */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CursorFilesError,
  type CursorFileDocument,
  type CursorFileKind,
  type CursorProjectView,
  type CursorRecommendation,
  emptyCursorProject,
  listCursorProject,
  readCursorFile,
  saveCursorFile,
  writeRecommendation,
} from '../runtime/cursor-files';

@Injectable()
export class ProjectCursorService {
  list(folder: string | null | undefined): CursorProjectView {
    if (!folder?.trim()) return emptyCursorProject();
    return this.wrap(() => listCursorProject(folder));
  }

  read(
    folder: string,
    kind: CursorFileKind,
    name: string,
    relativePath: string,
  ): CursorFileDocument {
    return this.wrap(() =>
      readCursorFile({ folder, kind, name, relativePath }),
    );
  }

  save(
    folder: string,
    kind: CursorFileKind,
    name: string,
    content: string,
    relativePath: string | null,
  ): CursorFileDocument {
    return this.wrap(() =>
      saveCursorFile({ folder, kind, name, content, relativePath }),
    );
  }

  /** Запись рекомендации только по явному запросу. Список её не включает. */
  addRecommendation(folder: string): CursorRecommendation {
    return this.wrap(() => writeRecommendation(folder));
  }

  private wrap<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof CursorFilesError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
