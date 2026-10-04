/** Вход через Cursor CLI: popup с loginUrl и снятие «Ожидание входа…» после success. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CursorConnection } from '../types'
import { SettingsPage } from './SettingsPage'

const harness = vi.hoisted(() => ({
  live: null as unknown,
  reload: vi.fn(),
  startCursorCliLogin: vi.fn(),
  loginTab: null as Window | null,
  openedUrls: [] as string[],
}))

vi.mock('../live', () => ({
  useLive: () => harness.live,
}))

vi.mock('../cursor-cli-login-tab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cursor-cli-login-tab')>()
  return {
    ...actual,
    openBlankLoginTab: () => harness.loginTab,
    navigateLoginTab: (
      tab: Window | null,
      url: string,
      openedUrl: string | null,
    ): ReturnType<typeof actual.navigateLoginTab> => {
      if (openedUrl === url) return 'already'
      if (!tab) return 'no-window'
      harness.openedUrls.push(url)
      return 'navigated'
    },
  }
})

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      startCursorCliLogin: (...args: Parameters<typeof actual.api.startCursorCliLogin>) =>
        harness.startCursorCliLogin(...args),
    },
  }
})

const loginUrl =
  'https://cursor.com/loginDeepControl?challenge=x&uuid=11111111-2222-3333-4444-555555555555&mode=login&redirectTarget=cli'

function cliCursor(overrides: Partial<CursorConnection>): CursorConnection {
  return {
    connected: false,
    source: 'none',
    hint: null,
    mode: 'cli',
    cliAgentAvailable: true,
    cliSessionSignedIn: false,
    cliAccountLabel: null,
    cliLogin: { status: 'idle', loginUrl: null, message: null },
    ...overrides,
  }
}

function setLive(cursor: CursorConnection) {
  harness.live = {
    ready: true,
    error: null,
    cursor,
    reload: harness.reload,
    agents: [],
    skills: [],
    workflows: [],
    presets: [],
    runs: [],
    tasks: [],
    projects: [],
  }
}

function mount(cursor: CursorConnection) {
  harness.reload.mockResolvedValue(undefined)
  setLive(cursor)
  return render(<SettingsPage />)
}

describe('SettingsPage CLI login', () => {
  beforeEach(() => {
    harness.loginTab = { closed: false } as Window
    harness.openedUrls = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('клик открывает вкладку с loginUrl из ответа backend', async () => {
    harness.startCursorCliLogin.mockResolvedValue(
      cliCursor({
        cliLogin: { status: 'pending', loginUrl, message: 'Ожидание…' },
      }),
    )
    mount(cliCursor({}))
    fireEvent.click(screen.getByTestId('cli-login-start'))
    await waitFor(() => {
      expect(harness.openedUrls).toEqual([loginUrl])
    })
  })

  it('после success GET убирает «Ожидание входа…» и показывает готовность', async () => {
    mount(
      cliCursor({
        connected: true,
        source: 'session',
        cliSessionSignedIn: true,
        cliAccountLabel: 'dev@example.com',
        cliLogin: { status: 'success', loginUrl, message: 'Вход выполнен.' },
      }),
    )
    expect(screen.getByTestId('cli-login-start').textContent).toBe('Войти через Cursor')
    expect(screen.getByText('Вход выполнен.')).toBeTruthy()
    expect(
      screen.getByText(/Вы успешно авторизовались как dev@example.com\. CLI готов к работе\./),
    ).toBeTruthy()
  })

  it('заблокированный popup не роняет вход', async () => {
    harness.loginTab = null
    harness.startCursorCliLogin.mockResolvedValue(
      cliCursor({
        cliLogin: { status: 'pending', loginUrl, message: 'Ожидание…' },
      }),
    )
    mount(cliCursor({}))
    fireEvent.click(screen.getByTestId('cli-login-start'))
    await waitFor(() => {
      expect(screen.getByText(/не дал открыть вкладку/i)).toBeTruthy()
    })
    expect(harness.startCursorCliLogin).toHaveBeenCalled()
  })

  it('при pending loginUrl из опроса попадает во вкладку', async () => {
    harness.startCursorCliLogin.mockResolvedValue(
      cliCursor({
        cliLogin: { status: 'pending', loginUrl: null, message: 'Ожидание ссылки…' },
      }),
    )
    const view = mount(cliCursor({}))
    fireEvent.click(screen.getByTestId('cli-login-start'))
    await waitFor(() => expect(harness.startCursorCliLogin).toHaveBeenCalled())
    setLive(
      cliCursor({
        cliLogin: { status: 'pending', loginUrl, message: 'Откройте ссылку…' },
      }),
    )
    view.rerender(<SettingsPage />)
    await waitFor(() => {
      expect(harness.openedUrls).toEqual([loginUrl])
    })
  })
})
