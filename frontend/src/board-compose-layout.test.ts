/** Проверка CSS формы «Новая задача» на доске. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'styles.css'),
  'utf8',
)

describe('форма compose на доске', () => {
  it('ограничивает высоту и включает вертикальную прокрутку', () => {
    expect(styles).toMatch(/\.compose\s*\{[\s\S]*max-height:/)
    expect(styles).toMatch(/\.compose\s*\{[\s\S]*overflow-y:\s*auto/)
  })

  it('выстраивает кнопки исполнителей и подвал формы в строки с переносом', () => {
    expect(styles).toMatch(/\.team-pick \.row-actions\s*\{[\s\S]*flex-direction:\s*row/)
    expect(styles).toMatch(/\.compose-footer\s*\{[\s\S]*flex-wrap:\s*wrap/)
  })
})
