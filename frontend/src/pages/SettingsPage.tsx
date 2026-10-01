/** Токен Cursor остаётся на сервере. В браузер возвращается только маска. */
import { useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { useLive } from '../live'

export function SettingsPage() {
  const { cursor, reload } = useLive()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

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

  const source =
    cursor?.source === 'saved' ? 'сохранён в данных сервера' : cursor?.source === 'env' ? 'задан в CURSOR_API_TOKEN' : 'не задан'

  return (
    <div className="page narrow">
      <h1 className="page-title">Настройки</h1>
      <section className="card form-card">
        <h2>Подключение Cursor</h2>
        <p className="hint" data-testid="cursor-setup-hint">
          Вставьте API-токен Cloud Agents Cursor. Он сохраняется только на сервере: браузер показывает «подключён»
          и последние четыре символа, сам токен сюда не возвращается. Шаги агентов со средой «Cursor» вызывают
          POST https://api.cursor.com/v1/agents; без токена такой шаг завершится ошибкой с объяснением.
        </p>
        <p data-testid="token-hint">
          Сейчас: {cursor?.connected ? 'подключён' : 'не подключён'} · {source}
          {cursor?.hint ? ` · ${cursor.hint}` : ''}
        </p>
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
      </section>
    </div>
  )
}
