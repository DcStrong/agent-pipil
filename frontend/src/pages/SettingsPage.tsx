/** Токен и ключ Cursor остаются на сервере. В браузер возвращается только маска. */
import { useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { useLive } from '../live'
import type { CursorConnectionMode } from '../types'

export function SettingsPage() {
  const { cursor, reload } = useLive()
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const mode: CursorConnectionMode = cursor?.mode ?? 'cli'

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

  async function clear() {
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
        : 'не задан'

  const modeHint =
    mode === 'cli'
      ? 'CLI запускает локальный agent в папке выбранного проекта на машине, где работает backend. Ключ CURSOR_API_KEY передаётся только в процесс agent на сервере.'
      : 'API вызывает POST https://api.cursor.com/v1/agents; токен хранится только на сервере.'

  const readyLabel =
    mode === 'cli'
      ? cursor?.connected
        ? 'CLI готов (agent и ключ)'
        : 'CLI не готов (нужны agent в PATH и ключ CURSOR_API_KEY)'
      : cursor?.connected
        ? 'подключён'
        : 'не подключён'

  const secretLabel = mode === 'cli' ? 'CURSOR_API_KEY' : 'API-токен'
  const secretPlaceholder =
    mode === 'cli' ? 'Вставьте ключ для CLI' : 'Вставьте токен'

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
          {` · ${mode === 'cli' ? 'ключ' : 'токен'} ${source}${cursor?.hint ? ` · ${cursor.hint}` : ''}`}
        </p>
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
            <button type="button" onClick={() => void clear()}>
              Удалить сохранённый
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
