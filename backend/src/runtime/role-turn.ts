/**
 * Имитация одной роли. В текст не попадают чужие диалоги и файлы .cursor.
 * Оркестратор не отвечает на вопрос вместо владельца.
 */
import type {
  AgentKind,
  HandoffBrief,
  ProjectSnapshot,
  ReturnShape,
  StepMode,
} from '../domain';
import { simulatedQuestionAnswer, userPromptFromTask } from './task-text';

export interface TurnInput {
  kind: AgentKind;
  name: string;
  task: string;
  stepMode: StepMode;
  brief: HandoffBrief | null;
  answer: string | null;
  project: ProjectSnapshot | null;
  developerShape: ReturnShape;
  developerPasses: number;
  asked: boolean;
}

export interface TurnResult {
  text: string;
  handoff: HandoffBrief;
  mapAddition: string | null;
  question: string | null;
  shape: ReturnShape;
  sentBack: boolean;
  fixedTest: boolean;
}

function subject(task: string): string {
  const line = task.trim().split('\n')[0] ?? 'Задача';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function wantsArray(task: string, brief: HandoffBrief | null, answer: string | null): boolean {
  const blob = `${task}\n${brief?.decided ?? ''}\n${answer ?? ''}`.toLowerCase();
  return blob.includes('массив');
}

function projectLine(project: ProjectSnapshot | null): string {
  if (!project?.available) return 'Папка проекта не задана. Смотрю только передачу.';
  const paths = [...project.rules, ...project.skills, ...project.commands];
  const where = paths.length
    ? `Пути .cursor, без текста файлов: ${paths.join(', ')}.`
    : 'В .cursor нет правил, навыков и команд.';
  if (project.mapText && project.mapPath) {
    return `Карту прочитал: ${project.mapPath}. ${where}`;
  }
  if (project.surveyed) {
    const glance = project.survey.slice(0, 8).join(', ') || 'каталог пуст';
    return `Карты нет и задача на неё не указала. Сам посмотрел проект: ${glance}. ${where}`;
  }
  if (project.pointedAtMap && project.mapMissing) {
    return `Указанная карта не найдена: ${project.mapPath ?? 'путь пуст'}. ${where}`;
  }
  return where;
}

function rabbitLine(project: ProjectSnapshot | null): string {
  const names = project?.survey ?? [];
  const edge = names.find((name) => /rabbit/i.test(name));
  if (edge) return `Внешний край виден в проекте: ${edge}.`;
  return 'Внешних краёв вроде Rabbit в обзоре не видно.';
}

export function roleTurn(input: TurnInput): TurnResult {
  const goal = input.brief?.goal || subject(input.task);
  const base = {
    shape: 'none' as ReturnShape,
    sentBack: false,
    fixedTest: false,
    question: null as string | null,
    mapAddition: null as string | null,
  };

  if (input.kind === 'orchestrator') {
    if (input.stepMode === 'question') {
      const reply = simulatedQuestionAnswer(input.task);
      return {
        ...base,
        text: reply,
        handoff: {
          goal: userPromptFromTask(input.task),
          decided: reply.slice(0, 240),
          now: 'Ответ имитации по тексту задачи.',
        },
      };
    }
    return {
      ...base,
      text: [
        'Новый диалог этой задачи. Старый чат не открываю.',
        projectLine(input.project),
        'Дальше передам только цель, уже решённое и текущий шаг.',
      ].join(' '),
      handoff: {
        goal,
        decided: 'Пока решений нет.',
        now: 'Следующая роль работает по этой передаче, без чужого диалога.',
      },
    };
  }

  if (input.kind === 'analyst') {
    return {
      ...base,
      text: [
        `Беру только передачу. Цель: ${goal}.`,
        projectLine(input.project),
        'В карту стоит добавить модуль этой задачи. Файл карты сам не пишу.',
      ].join(' '),
      mapAddition: `Модуль: ${goal}`,
      handoff: {
        goal,
        decided: `Аналитик оставил рамку: ${goal}.`,
        now: 'Не расширять задачу за эту рамку.',
      },
    };
  }

  if (input.kind === 'architect') {
    if (!input.answer && !input.asked) {
      const question =
        'Уточните контракт ответа: нужен массив объектов или один объект?';
      return {
        ...base,
        question,
        text: `${question} Жду владельца. Оркестратор за него не отвечает.`,
        handoff: {
          goal,
          decided: input.brief?.decided ?? 'Решения ещё нет.',
          now: 'Остановиться, пока владелец не ответит.',
        },
      };
    }
    const decision = (input.answer ?? input.brief?.decided ?? 'ответ получен').trim();
    return {
      ...base,
      text: `Ответ владельца принял: ${decision}. В передаче оставляю только это решение.`,
      mapAddition: `Связь: ответ задачи следует контракту «${decision.slice(0, 80)}»`,
      handoff: {
        goal,
        decided: decision,
        now: wantsArray(input.task, input.brief, input.answer)
          ? 'Разработчику вернуть массив объектов.'
          : 'Разработчику вернуть один объект.',
      },
    };
  }

  if (input.kind === 'developer') {
    const array = wantsArray(input.task, input.brief, null);
    const shape: ReturnShape = array && input.developerPasses === 0 ? 'object' : array ? 'array' : 'object';
    const spoken =
      shape === 'array'
        ? 'Возвращаю массив объектов, как в контракте.'
        : 'Возвращаю один объект.';
    return {
      ...base,
      shape,
      text: `${spoken} ${projectLine(input.project)}`,
      mapAddition: `Владение: бэкенд отвечает за результат «${goal}».`,
      handoff: {
        goal,
        decided: input.brief?.decided ?? 'Контракт не уточнён.',
        now: spoken,
      },
    };
  }

  if (input.kind === 'tester') {
    const tests = input.project?.tests ?? [];
    const stray = tests.find((name) => name.includes('посторонн'));
    const array = wantsArray(input.task, input.brief, null);
    if (stray) {
      return {
        ...base,
        fixedTest: true,
        text: [
          `Нашёл тесты: ${tests.join(', ')}.`,
          `Падающий ${stray} не совпадает с контрактом задачи, поэтому правлю тест, а не код.`,
          rabbitLine(input.project),
          'Чужие диалоги не читал.',
        ].join(' '),
        handoff: {
          goal,
          decided: input.brief?.decided ?? 'Контракт не уточнён.',
          now: 'Тест приведён к контракту, разработчику возврат не нужен.',
        },
      };
    }
    if (array && input.developerShape === 'object') {
      return {
        ...base,
        sentBack: true,
        text: [
          tests.length
            ? `Сначала прогнал существующие тесты: ${tests.join(', ')}.`
            : 'Готовых тестов нет. Написал проверку контракта и прогнал её имитацией.',
          'Код вернул один объект, а контракт ждёт массив объектов. Отдаю это разработчику.',
          'Тест из-за этой формы не переписываю.',
          rabbitLine(input.project),
          'Чужие диалоги не читал.',
        ].join(' '),
        handoff: {
          goal,
          decided: 'Контракт: массив объектов. Код вернул один объект.',
          now: 'Разработчику вернуть массив объектов.',
        },
      };
    }
    const testsLine = tests.length
      ? `Нашёл тесты и прогнал их имитацией: ${tests.join(', ')}.`
      : 'Тестов не было. Написал проверку и прогнал её имитацией.';
    return {
      ...base,
      text: [testsLine, rabbitLine(input.project), 'Чужие диалоги не читал.', projectLine(input.project)].join(' '),
      mapAddition: 'Документ: проверка контракта лежит рядом с задачей.',
      handoff: {
        goal,
        decided: input.brief?.decided ?? 'Проверка завершена.',
        now: 'Можно закрывать задачу.',
      },
    };
  }

  return {
    ...base,
    text: `Шаг «${input.name}». ${projectLine(input.project)}`,
    handoff: {
      goal,
      decided: input.brief?.decided ?? 'Без нового решения.',
      now: 'Передать коротко следующей роли.',
    },
  };
}

export function briefLine(brief: HandoffBrief): string {
  return `Цель: ${brief.goal}. Уже решено: ${brief.decided}. Сейчас: ${brief.now}.`;
}
