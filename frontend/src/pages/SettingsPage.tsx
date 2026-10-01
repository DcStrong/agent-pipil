/** Токен Cursor остаётся на сервере. В браузер возвращается только маска. */
import { useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { useLive } from '../live'
import type { CursorConnectionMode } from '../types'

export function SettingsPage() {
  const { cursor, reload } = useLive()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const mode: CursorConnectionMode = cursor?.mode ?? 'cli'

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNote(null)
    try {
      const next = await api.saveCursor(token)
      setToken('')
      await reload()
      setNote(next.hint ? `Сохранено. В интерфейсе видна только маска ${next.hint}.` : 'Сохранено.')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function clear() {
    setError(null)
    setNote(null)
    try {
      await api.clearCursor()
      await reload()
      setNote('Сохранённый токен удалён.')
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
    cursor?.source === 'saved' ? 'сохранён в данных сервера' : cursor?.source === 'env' ? 'задан в CURSOR_API_TOKEN' : 'не задан'

  const modeHint =
    mode === 'cli'
      ? 'CLI запускает локальный agent в папке выбранного проекта на машине, где работает backend. Агент видит файлы этой папки.'
      : 'API вызывает POST https://api.cursor.com/v1/agents; токен хранится только на сервере.'

  const readyLabel =
    mode === 'cli'
      ? cursor?.connected
        ? 'CLI «agent» найден на сервере'
        : 'CLI «agent» не найден на сервере'
      : cursor?.connected
        ? 'подключён'
        : 'не подключён'

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
          {mode === 'api' ? ` · токен ${source}${cursor?.hint ? ` · ${cursor.hint}` : ''}` : null}
        </p>
        {mode === 'api' ? (
          <form onSubmit={(event) => void save(event)}>
            <label className="field">
              <span>API-токен</span>
              <input
                type="password"
                autoComplete="off"
                data-testid="token-input"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Вставьте токен"
              />
            </label>
            {note ? <p className="ok-line">{note}</p> : null}
            {error ? <p className="error-line">{error}</p> : null}
            <div className="row-actions">
              <button type="submit" className="primary" data-testid="save-token">
                Сохранить на сервере
              </button>
              <button type="button" onClick={() => void clear()}>
                Удалить сохранённый
              </button>
            </div>
          </form>
        ) : (
          <>
            {note ? <p className="ok-line">{note}</p> : null}
            {error ? <p className="error-line">{error}</p> : null}
          </>
        )}
      </section>
    </div>
  )
}
