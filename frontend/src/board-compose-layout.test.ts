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
})
