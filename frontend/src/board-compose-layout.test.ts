/** Проверка CSS формы «Новая задача» на доске. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8')

describe('форма compose на доске', () => {
  it('ограничивает высоту и включает вертикальную прокрутку', () => {
    expect(styles).toMatch(/\.compose\s*\{[\s\S]*max-height:/)
    expect(styles).toMatch(/\.compose\s*\{[\s\S]*overflow-y:\s*auto/)
  })

  it('выстраивает кнопки формы в колонку', () => {
    expect(styles).toMatch(/\.compose \.row-actions\s*\{[\s\S]*flex-direction:\s*column/)
    expect(styles).toMatch(/\.team-pick \.row-actions\s*\{[\s\S]*flex-direction:\s*column/)
  })
})
