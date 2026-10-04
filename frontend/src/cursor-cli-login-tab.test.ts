import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigateLoginTab, openBlankLoginTab } from './cursor-cli-login-tab'

describe('cursor-cli-login-tab', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('openBlankLoginTab возвращает окно, если popup разрешён', () => {
    const location = { href: 'about:blank' }
    const win = { closed: false, location, opener: window } as unknown as Window
    const open = vi.fn(() => win)
    vi.stubGlobal('open', open)
    expect(openBlankLoginTab()).toBe(win)
    // noopener/noreferrer ломают сценарий: вкладка остаётся about:blank без ссылки.
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
  })

  it('navigateLoginTab ставит loginUrl, сбрасывает opener и не открывает одну ссылку дважды', () => {
    const location = { href: 'about:blank' }
    const win = { closed: false, location, opener: window } as unknown as Window
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli'
    expect(navigateLoginTab(win, url, null)).toBe('navigated')
    expect(win.opener).toBeNull()
    expect(location.href).toBe(url)
    expect(navigateLoginTab(win, url, url)).toBe('already')
    expect(location.href).toBe(url)
  })

  it('заблокированный popup не ломает сценарий — navigate без окна', () => {
    const url =
      'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli'
    expect(navigateLoginTab(null, url, null)).toBe('no-window')
  })
})
