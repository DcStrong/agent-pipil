/** Токен и ключ Cursor остаются на сервере. В браузер возвращается только маска. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { navigateLoginTab, openBlankLoginTab } from '../cursor-cli-login-tab'
import { useLive } from '../live'
import type { CursorConnectionMode } from '../types'

export function SettingsPage() {
  const { cursor, reload } = useLive()
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const mode: CursorConnectionMode = cursor?.mode ?? 'cli'
  const loginPending = mode === 'cli' && cursor?.cliLogin.status === 'pending'
  const loginTabRef = useRef<Window | null>(null)
  const openedLoginUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!loginPending) return
    const timer = window.setInterval(() => {
      void reload().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [loginPending, reload])

  const loginUrl = cursor?.cliLogin.loginUrl ?? null

  useEffect(() => {
    if (!loginPending || !loginUrl) return
    const result = navigateLoginTab(loginTabRef.current, loginUrl, openedLoginUrlRef.current)
    if (result === 'navigated') {
      openedLoginUrlRef.current = loginUrl
      setNote('Открыта вкладка Cursor для входа на этой машине.')
    } else if (result === 'closed' || result === 'no-window') {
      setNote(
        'Ссылка для входа готова — откройте её ниже вручную на той же машине, где работает backend.',
      )
    }
  }, [loginPending, loginUrl])

  useEffect(() => {
    if (mode !== 'cli' || cursor?.cliLogin.status !== 'success') return
    setNote(
      cursor.cliAccountLabel
        ? `Вы успешно авторизовались как ${cursor.cliAccountLabel}. CLI готов к работе.`
        : 'Вы успешно авторизовались. CLI готов к работе.',
    )
  }, [mode, cursor?.cliLogin.status, cursor?.cliAccountLabel])

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNote(null)
    try {
      const next =
        mode === 'cli' ? await api.saveCursorCliKey(secret) : await api.saveCursor(secret)
      setSecret('')
      await reload()
      setNote(next.hint ? `Сохранено. В интерфейсе видна только маска ${next.hint}.` : 'Сохранено.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function clearKey() {
    setError(null)
    setNote(null)
    try {
      await api.clearCursor()
      await reload()
      setNote(mode === 'cli' ? 'Сохранённый ключ удалён.' : 'Сохранённый токен удалён.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function startCliLogin() {
    setError(null)
    setNote(null)
    openedLoginUrlRef.current = null
    const loginTab = openBlankLoginTab()
    loginTabRef.current = loginTab
    const popupBlocked = loginTab === null
    try {
      const next = await api.startCursorCliLogin()
      await reload()
      const url = next.cliLogin.loginUrl
      if (url) {
        const nav = navigateLoginTab(loginTabRef.current, url, openedLoginUrlRef.current)
        if (nav === 'navigated') {
          openedLoginUrlRef.current = url
          setNote('Открыта вкладка Cursor для входа на этой машине.')
        } else if (popupBlocked) {
          setNote(
            'Браузер не дал открыть вкладку автоматически. Откройте ссылку ниже вручную на той же машине, где работает backend.',
          )
        } else {
          setNote(
            'Откройте ссылку ниже в этом браузере на той же машине, где работает backend. Не используйте старую вкладку.',
          )
        }
      } else if (popupBlocked) {
        setNote(
          (next.cliLogin.message ?? 'Запущен вход через CLI…') +
            ' Браузер не дал открыть вкладку — когда появится ссылка, откройте её вручную.',
        )
      } else {
        setNote(next.cliLogin.message ?? 'Запущен вход через CLI…')
      }
    } catch (reason) {
      try {
        loginTabRef.current?.close()
      } catch {
        // ignore
      }
      loginTabRef.current = null
      setError(messageOf(reason))
    }
  }

  async function revokeShell(base: string) {
    setError(null)
    setNote(null)
    try {
      await api.revokeShellGrant(base)
      await reload()
      setNote('Постоянное разрешение команды отозвано.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function revokeGrant(path: string) {
    setError(null)
    setNote(null)
    try {
      await api.revokeWorkspaceGrant(path)
      await reload()
      setNote('Постоянный доступ к папке отозван.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function logoutCliSession() {
    setError(null)
    setNote(null)
    try {
      await api.logoutCursorCliSession()
      await reload()
      setNote('Сессия CLI на сервере завершена.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function changeMode(next: CursorConnectionMode) {
    if (next === mode) return
    setError(null)
    setNote(null)
    try {
      await api.saveCursorMode(next)
      await reload()
      setNote(next === 'cli' ? 'Режим CLI: шаги Cursor на этой машине.' : 'Режим API: облачные агенты Cursor.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const source =
    cursor?.source === 'saved'
      ? 'сохранён в данных сервера'
      : cursor?.source === 'env'
        ? mode === 'cli'
          ? 'задан в CURSOR_API_KEY'
          : 'задан в CURSOR_API_TOKEN'
        : cursor?.source === 'session'
          ? 'вход через CLI на сервере'
          : 'не задан'

  const modeHint =
    mode === 'cli'
      ? 'CLI запускает локальный agent в папке проекта на машине backend. «Войти через Cursor» запускает `agent login` на сервере; ссылку нужно открыть на той же машине, пока процесс ждёт.'
      : 'API вызывает POST https://api.cursor.com/v1/agents; токен хранится только на сервере.'

  const readyLabel =
    mode === 'cli'
      ? cursor?.connected
        ? 'CLI готов'
        : cursor?.cliAgentAvailable
          ? 'CLI не готов (нужен вход или ключ)'
          : 'CLI «agent» не найден на сервере'
      : cursor?.connected
        ? 'подключён'
        : 'не подключён'

  const secretLabel = mode === 'cli' ? 'CURSOR_API_KEY' : 'API-токен'
  const secretPlaceholder = mode === 'cli' ? 'Ключ для CI или без интерактивного входа' : 'Вставьте токен'

  const loginMessage =
    cursor?.cliLogin.status === 'pending' ||
    cursor?.cliLogin.status === 'failed' ||
    cursor?.cliLogin.status === 'success'
      ? cursor.cliLogin.message
      : null

  return (
    <div className="page narrow">
      <h1 className="page-title">Настройки</h1>
      <section className="card form-card">
        <h2>Подключение Cursor</h2>
        <p className="hint" data-testid="cursor-setup-hint">
          Выберите, как шаги агентов со средой «Cursor» вызывают Cursor. По умолчанию — локальный CLI в папке проекта на
          сервере. Режим API оставляет облачный вызов Cloud Agents; без токена такой шаг завершится ошибкой с объяснением.
        </p>
        <fieldset className="field" data-testid="cursor-mode-field">
          <legend>Режим подключения</legend>
          <label className="row-actions">
            <input
              type="radio"
              name="cursor-mode"
              data-testid="cursor-mode-cli"
              checked={mode === 'cli'}
              onChange={() => void changeMode('cli')}
            />
            <span>CLI — локальный agent на сервере</span>
          </label>
          <label className="row-actions">
            <input
              type="radio"
              name="cursor-mode"
              data-testid="cursor-mode-api"
              checked={mode === 'api'}
              onChange={() => void changeMode('api')}
            />
            <span>API — Cloud Agents (облако)</span>
          </label>
        </fieldset>
        <p className="hint">{modeHint}</p>
        <p data-testid="token-hint">
          Сейчас: {readyLabel} · режим {mode === 'cli' ? 'CLI' : 'API'}
          {mode === 'cli' && cursor?.cliSessionSignedIn && cursor.cliAccountLabel
            ? ` · вошли как ${cursor.cliAccountLabel}`
            : null}
          {` · ${mode === 'cli' ? 'ключ' : 'токен'} ${source}${cursor?.hint ? ` · ${cursor.hint}` : ''}`}
        </p>
        {mode === 'cli' ? (
          <div className="field" data-testid="cli-login-block">
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                data-testid="cli-login-start"
                disabled={loginPending || !cursor?.cliAgentAvailable}
                onClick={() => void startCliLogin()}
              >
                {loginPending ? 'Ожидание входа…' : 'Войти через Cursor'}
              </button>
              <button
                type="button"
                data-testid="cli-logout"
                disabled={!cursor?.cliSessionSignedIn && cursor?.cliLogin.status !== 'success'}
                onClick={() => void logoutCliSession()}
              >
                Выйти из CLI
              </button>
            </div>
            {loginUrl ? (
              <p className="hint">
                Ссылка для входа:{' '}
                <a href={loginUrl} target="_blank" rel="noreferrer" data-testid="cli-login-link">
                  открыть страницу Cursor
                </a>
              </p>
            ) : null}
            {loginUrl ? (
              <label className="field">
                <span>URL из CLI (очищенная ссылка)</span>
                <input type="text" readOnly value={loginUrl} data-testid="cli-login-url" />
              </label>
            ) : null}
            {loginMessage ? <p className={cursor?.cliLogin.status === 'failed' ? 'error-line' : 'hint'}>{loginMessage}</p> : null}
            {(cursor?.shellGrants?.length ?? 0) > 0 ? (
              <div data-testid="shell-grants">
                <p className="hint">Команды с постоянным доступом</p>
                <ul>
                  {cursor?.shellGrants?.map((grant) => (
                    <li key={`${grant.base}:${grant.folder ?? ''}`}>
                      <span>
                        {grant.base}
                        {grant.folder ? ` · ${grant.folder}` : ''}
                      </span>{' '}
                      <button type="button" onClick={() => void revokeShell(grant.base)}>
                        Отозвать
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(cursor?.workspaceGrants?.length ?? 0) > 0 ? (
              <div data-testid="workspace-grants">
                <p className="hint">Папки с постоянным доступом для CLI</p>
                <ul>
                  {cursor?.workspaceGrants?.map((path) => (
                    <li key={path}>
                      <span>{path}</span>{' '}
                      <button
                        type="button"
                        data-testid={`revoke-grant-${path}`}
                        onClick={() => void revokeGrant(path)}
                      >
                        Отозвать
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <form onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>{secretLabel}</span>
            <input
              type="password"
              autoComplete="off"
              data-testid="token-input"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={secretPlaceholder}
            />
          </label>
          {note ? <p className="ok-line">{note}</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          <div className="row-actions">
            <button type="submit" className="primary" data-testid="save-token">
              Сохранить на сервере
            </button>
            <button type="button" onClick={() => void clearKey()}>
              {mode === 'cli' ? 'Удалить сохранённый ключ' : 'Удалить сохранённый токен'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
