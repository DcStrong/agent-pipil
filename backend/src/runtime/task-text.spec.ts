import { roleTurn } from './role-turn';
import {
  simulatedQuestionAnswer,
  splitRunTask,
  userPromptFromTask,
} from './task-text';

describe('task-text', () => {
  it('берёт тело задачи после заголовка', () => {
    expect(userPromptFromTask('Вопрос\n\nпривет')).toBe('привет');
    expect(splitRunTask('Вопрос\n\nпривет')).toEqual({
      title: 'Вопрос',
      body: 'привет',
    });
  });

  it('имитация отвечает на привет и не выдаёт обзор диска', () => {
    const answer = simulatedQuestionAnswer('Вопрос\n\nпривет');
    expect(answer).toContain('имитация');
    expect(answer).toContain('привет');
    expect(answer).not.toContain('.DS_Store');
    expect(answer).not.toContain('Сам посмотрел проект');
  });
});

describe('roleTurn orchestrator question', () => {
  it('не подменяет задачу служебным монологом', () => {
    const turn = roleTurn({
      kind: 'orchestrator',
      name: 'Оркестратор',
      task: 'Вопрос\n\nпривет',
      stepMode: 'question',
      brief: null,
      answer: null,
      project: {
        available: true,
        folder: '/tmp/x',
        surveyed: true,
        survey: ['.DS_Store', 'agent-pipil'],
        rules: [],
        skills: [],
        commands: [],
        tests: [],
        mapPath: null,
        mapText: null,
        mapMissing: false,
        pointedAtMap: false,
      },
      developerShape: 'none',
      developerPasses: 0,
      asked: false,
    });
    expect(turn.text).toContain('привет');
    expect(turn.text).not.toContain('Новый диалог этой задачи');
    expect(turn.text).not.toContain('.DS_Store');
  });

  it('в обычном режиме оркестратора оставляет передачу', () => {
    const turn = roleTurn({
      kind: 'orchestrator',
      name: 'Оркестратор',
      task: 'Сделать фичу',
      stepMode: 'automatic',
      brief: null,
      answer: null,
      project: null,
      developerShape: 'none',
      developerPasses: 0,
      asked: false,
    });
    expect(turn.text).toContain('Новый диалог этой задачи');
  });
});
