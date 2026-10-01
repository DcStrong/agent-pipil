/** Проверка CSS карточки задачи на доске. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8')

describe('карточка задачи на доске', () => {
  it('не наследует боковые отступы .hint у строки проекта', () => {
    expect(styles).toMatch(/\.task-card \.hint\s*\{[\s\S]*margin:\s*0/)
  })

  it('отделяет кнопки действий от текста', () => {
    expect(styles).toMatch(/\.task-card \.row-actions\s*\{[\s\S]*border-top:/)
  })
})
