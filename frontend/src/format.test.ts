import { describe, expect, it } from 'vitest'
import { splitRunTask } from './format'

describe('splitRunTask', () => {
  it('отделяет заголовок от текста задачи', () => {
    expect(splitRunTask('Вопрос\n\nпривет')).toEqual({
      title: 'Вопрос',
      body: 'привет',
    })
    expect(splitRunTask('привет')).toEqual({ title: 'привет', body: '' })
  })
})
