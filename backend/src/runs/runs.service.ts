import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, Subject } from 'rxjs';
import type {
  AccessDecision,
  AgentKind,
  Run,
  RunStep,
  StepMode,
  TaskPlan,
} from '../domain';
import { checklistItems } from '../runtime/task-order';
import { canResumeRun, roleOrder } from '../domain';
import { orderSteps } from '../runtime/step-graph';
import { persistShellAllow, projectAllowsShell } from '../runtime/shell-allow';
import { normalizeAccessPath } from '../runtime/workspace-trust';
import { applyRunToTask } from '../board/run-card';
import { CursorClient } from '../runtime/cursor-client';
import { Orchestrator, readDelayMs } from '../runtime/orchestrator';
import { projectRootForRun } from '../runtime/saved-project';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { StoreService } from '../store/store.service';

export type StreamMessage = { type: 'run'; run: Run } | { type: 'idle' };

@Injectable()
export class RunsService {
  private readonly updates = new Subject<StreamMessage>();
  private readonly orchestrator = new Orchestrator();
  private readonly cursor = new CursorClient();

  constructor(
    private readonly store: StoreService,
    private readonly settings: SettingsService,
    private readonly projects: ProjectsService,
  ) {}

  list(): Run[] {
    return this.store.read().runs;
  }

  get(id: string): Run {
    const run = this.store.getRun(id);
    if (!run) throw new NotFoundException('Запуск не найден.');
    return run;
  }

  watch(): Observable<StreamMessage> {
    return new Observable((subscriber) => {
      const current = this.store.relevantRun();
      subscriber.next(
        current ? { type: 'run', run: current } : { type: 'idle' },
      );
      const subscription = this.updates.subscribe((event) =>
        subscriber.next(event),
      );
      return () => subscription.unsubscribe();
    });
  }

  start(
    workflowId: string,
    task: string,
    options?: {
      roleIds?: string[];
      projectPath?: string | null;
      projectId?: string | null;
      mapPath?: string | null;
      deepThinking?: boolean;
    },
  ): Run {
    const trimmed = task.trim();
    if (!trimmed) throw new BadRequestException('Сначала напишите задачу.');
    if (trimmed.length > 4000)
      throw new BadRequestException('Задача короче 4000 символов.');
    if (this.store.hasActiveRun()) {
      throw new ConflictException('Сейчас уже идёт один запуск.');
    }
    const steps = options?.roleIds
      ? this.snapshotRoles(options.roleIds)
      : this.snapshot(workflowId);
    const needsProject = steps.some((step) => step.harness === 'cursor');
    const projectId = options?.projectId?.trim() ?? '';
    const projectPath = options?.projectPath?.trim() ?? '';
    if (needsProject && !projectId && !projectPath) {
      throw new BadRequestException(
        'Для шага со средой Cursor нужен проект или workspace. Укажите его в задаче или в параметрах запуска.',
      );
    }
    const workflow = this.store
      .read()
      .workflows.find((item) => item.id === workflowId);
    const now = new Date().toISOString();
    const snapshot = this.projects.snapshotForRun(
      projectId || null,
      projectPath || null,
      options?.mapPath ?? null,
    );
    if (needsProject && !snapshot.folder) {
      throw new BadRequestException(
        'Проект или workspace не найден на этой машине. Проверьте путь в разделе «Проект».',
      );
    }
    const run: Run = {
      id: randomUUID(),
      workflowId,
      workflowName: workflow?.name ?? 'Процесс',
      task: trimmed,
      status: 'running',
      stepIndex: null,
      steps,
      work: [],
      events: [
        {
          id: randomUUID(),
          at: now,
          kind: 'progress',
          message: 'Задача вошла в процесс.',
          stepIndex: null,
        },
      ],
      finalResult: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      project: snapshot.project,
      developerShape: 'none',
      pendingQuestion: null,
      pendingAccess: null,
      mapWritten: false,
      mapNote: null,
      deepThinking: options?.deepThinking === true,
      note: null,
      plan: null,
      buildText: null,
      reviewText: null,
      taskFolder: null,
      archive: null,
    };
    this.store.upsertRun(run);
    this.launch(run, {
      projectFolder: snapshot.folder,
      workspaceFile: snapshot.workspaceFile,
    });
    return this.store.getRun(run.id) ?? run;
  }

  /** Продолжает прерванный запуск с текущего шага, не стирая готовую работу. */
  resume(id: string, mode: 'continue' | 'retry'): Run {
    const current = this.get(id);
    if (!canResumeRun(current)) {
      throw new BadRequestException(
        'Продолжить можно только прерванный запуск или шаг с ошибкой.',
      );
    }
    if (this.store.hasActiveRun() || this.orchestrator.peek(id)) {
      throw new ConflictException('Сейчас уже идёт один запуск.');
    }
    const startAt = this.resumeStepIndex(current);
    const step = current.steps[startAt];
    const hasSession =
      mode === 'continue' && Boolean(step?.cliSessionId?.trim());
    if (mode === 'retry' && step) step.cliSessionId = null;
    const savedError = current.error;
    const now = new Date().toISOString();
    current.status = 'running';
    current.error = null;
    current.finishedAt = null;
    current.pendingQuestion = null;
    current.pendingAccess = null;
    current.updatedAt = now;
    current.events.push({
      id: randomUUID(),
      at: now,
      kind: 'progress',
      message: step
        ? mode === 'retry'
          ? `Повтор шага «${step.title}». Готовые шаги сохранены.`
          : `Продолжение шага «${step.title}». Готовые шаги сохранены.`
        : mode === 'retry'
          ? 'Повтор запуска с места обрыва.'
          : 'Продолжение запуска с места обрыва.',
      stepIndex: startAt,
    });
    this.store.upsertRun(current);
    this.launch(current, {
      startAtStep: startAt,
      resumeMode: mode,
      retryError: hasSession ? null : savedError,
    });
    return this.get(id);
  }

  decide(id: string, approved: boolean): Run {
    const current = this.get(id);
    if (!approved && current.status === 'waiting_user') {
      return this.haltOpen(id, 'Владелец отклонил вопрос.');
    }
    if (current.status !== 'waiting_approval') {
      throw new BadRequestException('Этот запуск не ждёт подтверждения.');
    }
    this.ensureWait(current);
    const accepted = this.orchestrator.decide(id, approved);
    if (!accepted) {
      throw new BadRequestException('Подтверждение уже некому передать.');
    }
    const live = this.orchestrator.peek(id);
    if (live) this.publishLive(live);
    return this.get(id);
  }

  grantAccess(id: string, decision: AccessDecision): Run {
    const current = this.get(id);
    if (current.status !== 'waiting_access' || !current.pendingAccess) {
      throw new BadRequestException('Этот запуск не ждёт доступа к папке.');
    }
    this.ensureWait(current);
    const accepted = this.orchestrator.grantAccess(id, decision);
    if (!accepted) {
      throw new BadRequestException('Решение по доступу уже некому передать.');
    }
    const live = this.orchestrator.peek(id);
    if (live) this.publishLive(live);
    return this.get(id);
  }

  /** Заканчивает открытый запуск, чтобы холст снова можно было править. */
  stop(id: string): Run {
    const current = this.get(id);
    if (!this.isOpenStatus(current.status)) {
      throw new BadRequestException('Этот запуск уже закончен.');
    }
    return this.haltOpen(id, 'Запуск остановлен.');
  }

  /** Кладёт поправленный план и отпускает сборку. */
  savePlan(
    id: string,
    raw: {
      why?: unknown;
      changes?: unknown;
      how?: unknown;
      checklist?: unknown;
    },
  ): Run {
    const current = this.get(id);
    if (current.status !== 'waiting_plan') {
      throw new BadRequestException('Этот запуск не ждёт правки плана.');
    }
    const plan: TaskPlan = {
      why: this.planField(raw.why, 'Зачем'),
      changes: this.planField(raw.changes, 'Что меняется'),
      how: this.planField(raw.how, 'Как'),
      checklist: this.planField(raw.checklist, 'Чеклист'),
    };
    if (checklistItems(plan.checklist).length === 0) {
      throw new BadRequestException('В чеклисте нужна хотя бы одна строка.');
    }
    this.ensureWait(current);
    const accepted = this.orchestrator.revise(id, plan);
    if (!accepted) {
      throw new BadRequestException('План уже некому передать.');
    }
    return this.get(id);
  }

  /** Ответ владельца уходит только в диалог роли, которая спросила. */
  answer(id: string, text: string): Run {
    const current = this.get(id);
    if (current.status !== 'waiting_user') {
      throw new BadRequestException('Этот запуск не ждёт ответа.');
    }
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Сначала напишите ответ.');
    if (trimmed.length > 2000) {
      throw new BadRequestException('Ответ короче 2000 символов.');
    }
    this.ensureWait(current);
    const accepted = this.orchestrator.answer(id, trimmed);
    if (!accepted) {
      throw new BadRequestException('Ответ уже некому передать.');
    }
    return this.get(id);
  }

  private resumeStepIndex(run: Run): number {
    if (
      run.stepIndex !== null &&
      run.stepIndex >= 0 &&
      run.stepIndex < run.steps.length
    ) {
      return run.stepIndex;
    }
    const finished = new Set(run.work.map((item) => item.stepId));
    const firstOpen = run.steps.findIndex((step) => !finished.has(step.stepId));
    if (firstOpen >= 0) return firstOpen;
    return Math.max(0, run.steps.length - 1);
  }

  private ensureWait(run: Run): void {
    if (this.orchestrator.hasWaiter(run.id)) return;
    this.orchestrator.bindSavedWait(
      run,
      (published) => this.publishLive(published),
      this.optionsFor(run),
    );
  }

  private launch(
    run: Run,
    extra: {
      projectFolder?: string | null;
      workspaceFile?: string | null;
      startAtStep?: number;
      resumeMode?: 'continue' | 'retry';
      retryError?: string | null;
    },
  ): void {
    const paths = this.pathsFor(run);
    void this.orchestrator
      .execute(run, (published) => this.publishLive(published), {
        ...this.optionsFor(run),
        projectFolder: extra.projectFolder ?? paths.projectFolder,
        workspaceFile: extra.workspaceFile ?? paths.workspaceFile,
        startAtStep: extra.startAtStep,
        resumeMode: extra.resumeMode,
        retryError: extra.retryError,
      })
      .catch(() => undefined);
  }

  private pathsFor(run: Run): {
    projectFolder: string | null;
    workspaceFile: string | null;
  } {
    const projectFolder = run.project?.folder ?? null;
    let workspaceFile: string | null = null;
    if (projectFolder) {
      const saved = this.store.read().projects.find((item) => {
        try {
          return (
            projectRootForRun(item) === projectFolder ||
            item.path === projectFolder
          );
        } catch {
          return false;
        }
      });
      if (saved?.kind === 'workspace') workspaceFile = saved.path;
    }
    return { projectFolder, workspaceFile };
  }

  private optionsFor(run: Run) {
    const cursorMode = this.settings.connectionMode();
    const cursorConnected = this.settings.cursorReady();
    const live =
      this.cursor.liveEnabled() &&
      run.steps.some((step) => step.harness === 'cursor');
    const paths = this.pathsFor(run);
    return {
      delayMs: readDelayMs(),
      cursorConnected,
      live,
      cursorMode,
      cursorToken: this.settings.apiToken(),
      resolveCliAuth: async () => {
        await this.settings.ensureCliAuthChecked(process.env, 0);
        return {
          ready: this.settings.cliAuthReady(),
          apiKey: this.settings.cliApiKey(),
        };
      },
      projectFolder: paths.projectFolder,
      workspaceFile: paths.workspaceFile,
      isWorkspaceTrusted: (path: string) => this.workspaceTrusted(path),
      grantWorkspaceAlways: (path: string) => this.rememberWorkspace(path),
      isShellAllowed: (base: string, folder: string) =>
        this.shellAllowed(base, folder),
      grantShellAlways: (base: string, folder: string) =>
        this.rememberShell(base, folder),
    };
  }

  private haltOpen(id: string, reason: string): Run {
    const live = this.orchestrator.requestHalt(id, reason);
    if (live && (live.status === 'failed' || live.status === 'completed')) {
      this.publishLive(live);
      return this.get(id);
    }
    const again = this.get(id);
    if (!this.isOpenStatus(again.status)) return again;
    const at = new Date().toISOString();
    again.status = 'failed';
    again.error = reason;
    again.pendingQuestion = null;
    again.pendingAccess = null;
    again.finishedAt = at;
    again.updatedAt = at;
    again.events.push({
      id: randomUUID(),
      at,
      kind: 'error',
      message: reason,
      stepIndex: again.stepIndex,
    });
    this.store.upsertRun(again);
    this.syncBoardFromRun(again);
    this.updates.next({ type: 'run', run: structuredClone(again) });
    return this.get(id);
  }

  private publishLive(run: Run): void {
    const snapshot = structuredClone(run);
    this.store.upsertRun(snapshot);
    this.syncBoardTaskUsage(snapshot);
    this.syncBoardFromRun(snapshot);
    this.updates.next({ type: 'run', run: snapshot });
  }

  /** Колонка и заметки карточки повторяют статус запуска. */
  private syncBoardFromRun(run: Run): void {
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.runId === run.id);
      if (!task) return;
      applyRunToTask(task, run);
    });
  }

  /** Копирует расход запуска на карточку задачи доски. */
  private syncBoardTaskUsage(run: Run): void {
    if (!run.usage) return;
    this.store.mutate((state) => {
      const task = state.tasks.find((item) => item.runId === run.id);
      if (!task) return;
      task.usage = structuredClone(run.usage);
      task.updatedAt = new Date().toISOString();
    });
  }

  private isOpenStatus(status: Run['status']): boolean {
    return (
      status === 'running' ||
      status === 'waiting_approval' ||
      status === 'waiting_user' ||
      status === 'waiting_plan' ||
      status === 'waiting_access'
    );
  }

  private workspaceTrusted(path: string): boolean {
    const key = normalizeAccessPath(path);
    return this.store
      .read()
      .accessGrants.some(
        (grant) => grant.kind === 'workspace' && grant.path === key,
      );
  }

  private rememberWorkspace(path: string): void {
    const key = normalizeAccessPath(path);
    this.store.mutate((state) => {
      if (
        state.accessGrants.some(
          (grant) => grant.kind === 'workspace' && grant.path === key,
        )
      ) {
        return;
      }
      state.accessGrants.push({
        kind: 'workspace',
        path: key,
        grantedAt: new Date().toISOString(),
        folder: null,
      });
    });
  }

  private shellAllowed(base: string, folder: string): boolean {
    const saved = this.store
      .read()
      .accessGrants.some(
        (grant) =>
          grant.kind === 'shell' &&
          grant.path === base &&
          (grant.folder === folder || grant.folder === null),
      );
    return saved || projectAllowsShell(folder, base);
  }

  private rememberShell(base: string, folder: string): void {
    persistShellAllow(folder, base);
    this.store.mutate((state) => {
      if (
        state.accessGrants.some(
          (grant) =>
            grant.kind === 'shell' &&
            grant.path === base &&
            grant.folder === folder,
        )
      ) {
        return;
      }
      state.accessGrants.push({
        kind: 'shell',
        path: base,
        folder,
        grantedAt: new Date().toISOString(),
      });
    });
  }

  private planField(value: unknown, label: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${label} нужно написать текстом.`);
    }
    const trimmed = value.trim();
    if (!trimmed)
      throw new BadRequestException(`${label} не может быть пустым.`);
    if (trimmed.length > 2000) {
      throw new BadRequestException(`${label} короче 2000 символов.`);
    }
    return trimmed;
  }

  private freshStep(
    stepId: string,
    agent: {
      id: string;
      name: string;
      kind: AgentKind;
      instructions: string;
      harness: RunStep['harness'];
    },
    title: string,
    mode: StepMode,
    handoff: string,
  ): RunStep {
    const state = this.store.read();
    const shared = state.skills.filter((skill) => skill.scope === 'shared');
    const own = state.skills.filter(
      (skill) => skill.scope === 'agent' && skill.agentId === agent.id,
    );
    return {
      stepId,
      agentId: agent.id,
      agentName: agent.name,
      title,
      mode,
      handoff,
      instructions: agent.instructions,
      harness: agent.harness,
      skills: [...shared, ...own].map((skill) => ({
        name: skill.name,
        instructions: skill.instructions,
        scope: skill.scope,
      })),
      dialogueId: randomUUID(),
      kind: agent.kind,
      messages: [],
      brief: null,
      question: null,
      mapAddition: null,
      cliSessionId: null,
    };
  }

  /** Отдельный новый диалог на каждую выбранную роль. */
  private snapshotRoles(roleIds: string[]): RunStep[] {
    const unique = [...new Set(roleIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new BadRequestException('Выберите хотя бы одну роль.');
    }
    const agents = this.store.read().agents;
    const chosen = unique.map((id) => {
      const agent = agents.find((item) => item.id === id);
      if (!agent)
        throw new BadRequestException('Среди ролей есть неизвестная.');
      return agent;
    });
    chosen.sort((left, right) => roleOrder(left.kind) - roleOrder(right.kind));
    return chosen.map((agent) =>
      this.freshStep(
        randomUUID(),
        agent,
        agent.name,
        agent.kind === 'architect' ? 'question' : 'automatic',
        '',
      ),
    );
  }

  private snapshot(workflowId: string): RunStep[] {
    const state = this.store.read();
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new NotFoundException('Процесс не найден.');
    if (workflow.steps.length === 0) {
      throw new BadRequestException('В процессе нет шагов.');
    }
    return orderSteps(workflow.steps).map((step) => {
      const agent = state.agents.find((item) => item.id === step.agentId);
      if (!agent)
        throw new BadRequestException('Шаг ссылается на удалённого агента.');
      return this.freshStep(
        step.id,
        agent,
        step.title,
        step.mode,
        step.handoff,
      );
    });
  }
}
