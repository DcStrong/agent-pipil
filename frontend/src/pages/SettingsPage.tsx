/** Токен и ключ Cursor остаются на сервере. В браузер возвращается только маска. */
import { useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { useLive } from '../live'
import type { CursorConnectionMode } from '../types'

export function SettingsPage() {
  const { cursor, reload } = useLive()
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const mode: CursorConnectionMode = cursor?.mode ?? 'cli'
  const loginPending = mode === 'cli' && cursor?.cliLogin.status === 'pending'

  useEffect(() => {
    if (!loginPending) return
    const timer = window.setInterval(() => {
      void reload().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [loginPending, reload])

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
    try {
      const next = await api.startCursorCliLogin()
      await reload()
      if (next.cliLogin.loginUrl) {
        setNote(
          'Откройте ссылку ниже в этом браузере на той же машине, где работает backend. Не используйте старую вкладку.',
        )
      } else {
        setNote(next.cliLogin.message ?? 'Запущен вход через CLI…')
      }
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
    cursor?.cliLogin.status === 'pending'
      ? cursor.cliLogin.message
      : cursor?.cliLogin.status === 'failed'
        ? cursor.cliLogin.message
        : null

  const loginUrl = cursor?.cliLogin.loginUrl ?? null

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
