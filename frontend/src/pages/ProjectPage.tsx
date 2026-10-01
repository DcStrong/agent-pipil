/** Проекты на сервере и правка .cursor в выбранной папке. */
import { useEffect, useState, type FormEvent } from 'react'
import { api, messageOf } from '../api'
import { IconPlus } from '../components/Icons'
import { useLive } from '../live'
import type { CursorFileItem, CursorFileKind, CursorProjectView, CursorRecommendation, SavedProjectKind } from '../types'

const SELECTED_PROJECT_KEY = 'pipil-selected-project'
const STORAGE_KEY = 'pipil-project-folder'

function storedFolder(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function storedSelectedProject(): string {
  try {
    return sessionStorage.getItem(SELECTED_PROJECT_KEY) ?? ''
  } catch {
    return ''
  }
}

const SUGGESTION: CursorRecommendation = {
  id: 'machine-runs',
  title: 'Запуски на машине пользователя',
  text: 'Запуски, тесты и логи происходят на машине пользователя, а не внутри агента. Обычный агент их не запускает, пока его не попросят. Тестировщик может их запустить, всё ещё на машине, и в диалог кладёт только вердикт, не лог.',
  relativePath: '.cursor/rules/запуски-на-машине.mdc',
  added: false,
}

interface EditorState {
  mode: 'create' | 'edit'
  kind: CursorFileKind
  name: string
  relativePath: string | null
  content: string
}

const GROUPS: Array<{ kind: CursorFileKind; title: string; place: string }> = [
  { kind: 'rule', title: 'Правила Cursor', place: '.cursor/rules' },
  { kind: 'skill', title: 'Навыки', place: '.cursor/skills' },
  { kind: 'mcp', title: 'Конфигурация MCP', place: '.cursor/mcp.json' },
]

function draft(kind: CursorFileKind): string {
  if (kind === 'rule') return '---\ndescription:\nalwaysApply: false\n---\n\nТекст правила.\n'
  if (kind === 'skill') return '---\nname:\ndescription:\n---\n\nКогда применять навык и что делать.\n'
  return '{\n  "command": "",\n  "args": []\n}\n'
}

function targetOf(editor: EditorState): string {
  if (editor.mode === 'edit' && editor.relativePath) {
    if (editor.kind === 'mcp' && editor.name !== 'mcp.json') {
      return `${editor.relativePath} · сервер «${editor.name}»`
    }
    return editor.relativePath
  }
  const name = editor.name.trim()
  if (editor.kind === 'rule') {
    if (!name) return '.cursor/rules/имя.mdc'
    return `.cursor/rules/${/\.(md|mdc|mdx)$/i.test(name) ? name : `${name}.mdc`}`
  }
  if (editor.kind === 'skill') return `.cursor/skills/${name || 'имя'}/SKILL.md`
  if (name === 'mcp.json') return '.cursor/mcp.json'
  return `.cursor/mcp.json · сервер «${name || 'имя'}»`
}

function itemsOf(view: CursorProjectView, kind: CursorFileKind): CursorFileItem[] {
  if (kind === 'rule') return view.rules
  if (kind === 'skill') return view.skills
  return view.mcp
}

export function ProjectPage() {
  const { cursor, projects, upsertProject, removeProject } = useLive()
  const [pathInput, setPathInput] = useState(storedFolder)
  const [folder, setFolder] = useState<string | null>(null)
  const [view, setView] = useState<CursorProjectView | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addKind, setAddKind] = useState<SavedProjectKind>('folder')
  const [addPath, setAddPath] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(storedSelectedProject)
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    void load(storedFolder(), false)
  }, [])

  async function load(nextFolder: string, keepNote: boolean) {
    setBusy(true)
    setError(null)
    if (!keepNote) setNote(null)
    try {
      const next = await api.cursorProject(nextFolder)
      setView(next)
      setFolder(nextFolder.trim() || null)
      if (nextFolder.trim()) {
        try {
          sessionStorage.setItem(STORAGE_KEY, nextFolder.trim())
        } catch {
          // Папка останется в поле.
        }
      }
      return next
    } catch (reason) {
      setError(messageOf(reason))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function show(event: FormEvent) {
    event.preventDefault()
    setEditor(null)
    await load(pathInput, false)
  }

  async function addSavedProject(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const created = await api.addProject({ kind: addKind, path: addPath })
      upsertProject(created)
      setAddPath('')
      setNote(
        addKind === 'folder'
          ? `Папка «${created.folderName}» добавлена в список на сервере.`
          : `Workspace «${created.folderName}» добавлен в список на сервере.`,
      )
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function saveAlias(id: string) {
    const alias = aliasDraft[id] ?? ''
    setBusy(true)
    setError(null)
    try {
      upsertProject(await api.updateProjectAlias(id, alias))
      setNote('Алиас сохранён.')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function dropProject(id: string) {
    setBusy(true)
    setError(null)
    try {
      await api.removeProject(id)
      removeProject(id)
      if (selectedProjectId === id) {
        setSelectedProjectId('')
        try {
          sessionStorage.removeItem(SELECTED_PROJECT_KEY)
        } catch {
          // ignore
        }
      }
      setNote('Запись убрана из списка.')
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  function pickForRun(id: string) {
    setSelectedProjectId(id)
    try {
      sessionStorage.setItem(SELECTED_PROJECT_KEY, id)
    } catch {
      // ignore
    }
    const picked = projects.find((item) => item.id === id)
    if (picked?.kind === 'folder') {
      setPathInput(picked.path)
      void load(picked.path, false)
    }
  }

  function beginCreate(kind: CursorFileKind) {
    setError(null)
    setNote(null)
    setEditor({ mode: 'create', kind, name: '', relativePath: null, content: draft(kind) })
  }

  async function openItem(item: CursorFileItem) {
    if (!folder) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const document = await api.cursorFile(folder, item)
      setEditor({
        mode: 'edit',
        kind: document.kind,
        name: document.name,
        relativePath: document.relativePath,
        content: document.content,
      })
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editor || !folder) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const saved = await api.saveCursorFile({
        folder,
        kind: editor.kind,
        name: editor.name,
        content: editor.content,
        relativePath: editor.mode === 'edit' ? editor.relativePath : null,
      })
      setEditor({
        mode: 'edit',
        kind: saved.kind,
        name: saved.name,
        relativePath: saved.relativePath,
        content: saved.content,
      })
      setNote(`Записано в ${saved.relativePath}.`)
      await load(folder, true)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function addRecommendation() {
    if (!folder || !view?.available || view.recommendation.added) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const written = await api.addRecommendation(folder)
      setView((current) => (current ? { ...current, recommendation: written } : current))
      setNote(`Правило записано в ${written.relativePath}. До кнопки его в проекте не было.`)
      await load(folder, true)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const recommendation = view?.recommendation ?? SUGGESTION
  const ready = Boolean(view?.available && folder)
  const selectedKey = editor?.mode === 'edit' ? `${editor.kind}:${editor.name}:${editor.relativePath}` : ''

  return (
    <div className="page">
      <h1 className="page-title">Проект</h1>
      <p className="page-lead" data-testid="cursor-disconnected">
        Список локальных папок и файлов <code>.code-workspace</code> хранится на сервере. Для живого шага Cursor
        выберите проект ниже
        {cursor?.mode === 'api'
          ? ` и сохраните API-токен в настройках${cursor.connected ? ' (подключён)' : ' (не подключён — шаг Cursor завершится ошибкой)'}`
          : `${cursor?.connected ? ' (CLI на сервере готов)' : ' (на сервере не найден CLI «agent» — шаг Cursor завершится ошибкой)'}`}
        .
      </p>

      <section className="card" data-testid="saved-projects">
        <h2>Сохранённые проекты</h2>
        <form className="path-bar" onSubmit={(event) => void addSavedProject(event)}>
          <label className="field">
            <span>Тип</span>
            <select
              data-testid="project-kind"
              value={addKind}
              onChange={(event) => setAddKind(event.target.value as SavedProjectKind)}
            >
              <option value="folder">Папка</option>
              <option value="workspace">Cursor workspace (.code-workspace)</option>
            </select>
          </label>
          <label className="field">
            <span>Путь на этой машине</span>
            <input
              data-testid="project-add-path"
              value={addPath}
              placeholder={addKind === 'folder' ? '/path/to/project' : '/path/to/team.code-workspace'}
              autoComplete="off"
              onChange={(event) => setAddPath(event.target.value)}
            />
          </label>
          <button type="submit" className="primary" data-testid="add-project" disabled={busy || !addPath.trim()}>
            Добавить
          </button>
        </form>
        {projects.length === 0 ? (
          <p className="empty">Пока нет сохранённых проектов.</p>
        ) : (
          <ul className="file-list">
            {projects.map((item) => (
              <li key={item.id}>
                <div className="file-row" data-testid="saved-project-row">
                  <div>
                    <strong data-testid="project-label">{item.label}</strong>
                    <small>
                      {item.kind === 'workspace' ? 'workspace' : 'папка'} · имя: {item.folderName} · {item.path}
                    </small>
                  </div>
                  <label className="field inline">
                    <span>Алиас</span>
                    <input
                      data-testid="project-alias"
                      value={aliasDraft[item.id] ?? item.alias}
                      placeholder={item.folderName}
                      onChange={(event) =>
                        setAliasDraft((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  </label>
                  <div className="row-actions">
                    <button type="button" disabled={busy} onClick={() => void saveAlias(item.id)}>
                      Сохранить алиас
                    </button>
                    <button
                      type="button"
                      className={selectedProjectId === item.id ? 'primary' : undefined}
                      data-testid="select-project"
                      disabled={busy}
                      onClick={() => pickForRun(item.id)}
                    >
                      {selectedProjectId === item.id ? 'Выбран для запуска' : 'Выбрать для запуска'}
                    </button>
                    <button type="button" data-testid="remove-project" disabled={busy} onClick={() => void dropProject(item.id)}>
                      Убрать
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="section-title">Файлы .cursor</h2>
      <form className="path-bar" onSubmit={(event) => void show(event)}>
        <label className="field">
          <span>Папка проекта</span>
          <input
            data-testid="cursor-project-path"
            value={pathInput}
            placeholder="Путь к папке на этой машине"
            autoComplete="off"
            onChange={(event) => setPathInput(event.target.value)}
          />
        </label>
        <button type="submit" className="primary" data-testid="show-project" disabled={busy || !pathInput.trim()}>
          Показать
        </button>
      </form>
      {folder ? (
        <p className="where" data-testid="loaded-folder">
          Сейчас: {view?.folder ?? folder}
          {view && !view.available ? '. Папка не найдена, списки пустые.' : ''}
        </p>
      ) : (
        <p className="where">Укажите папку и нажмите «Показать», чтобы править .cursor.</p>
      )}
      {error ? <p className="error-line">{error}</p> : null}
      {note ? <p className="ok-line">{note}</p> : null}

      <div className="project-grid">
        <div className="group-stack">
          {GROUPS.map((group) => {
            const items = view ? itemsOf(view, group.kind) : []
            return (
              <section key={group.kind} className="card" data-testid={`group-${group.kind}`}>
                <div className="card-head">
                  <span>
                    {group.title}
                    <i className="count">{items.length}</i>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Добавить: ${group.title}`}
                    data-testid={`add-${group.kind}`}
                    disabled={!ready || busy}
                    onClick={() => beginCreate(group.kind)}
                  >
                    <IconPlus />
                  </button>
                </div>
                <p className="group-place">{group.place}</p>
                {items.length === 0 ? <p className="empty">Пока пусто.</p> : null}
                <ul className="file-list">
                  {items.map((item) => {
                    const key = `${item.kind}:${item.name}:${item.relativePath}`
                    const on = key === selectedKey
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={on ? 'file-row on' : 'file-row'}
                          data-testid={`file-${item.kind}`}
                          data-path={item.relativePath}
                          data-name={item.name}
                          onClick={() => void openItem(item)}
                        >
                          <strong>{item.name}</strong>
                          <small>{item.relativePath}</small>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>

        <section className="card editor-card" data-testid="file-editor">
          {editor ? (
            <form onSubmit={(event) => void save(event)}>
              <h2>{editor.mode === 'create' ? 'Новый файл' : 'Правка'}</h2>
              <p className="where" data-testid="file-target">
                Куда: {targetOf(editor)}
              </p>
              {editor.mode === 'create' ? (
                <label className="field">
                  <span>{editor.kind === 'mcp' ? 'Имя сервера' : editor.kind === 'skill' ? 'Имя навыка' : 'Имя файла'}</span>
                  <input
                    data-testid="file-name"
                    value={editor.name}
                    autoComplete="off"
                    onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                  />
                </label>
              ) : (
                <p className="where">
                  {editor.kind === 'mcp' && editor.name !== 'mcp.json' ? `Сервер «${editor.name}»` : editor.name}
                </p>
              )}
              <label className="field">
                <span>Текст</span>
                <textarea
                  data-testid="file-content"
                  value={editor.content}
                  onChange={(event) => setEditor({ ...editor, content: event.target.value })}
                />
              </label>
              <div className="row-actions">
                <button type="submit" className="primary" data-testid="save-file" disabled={busy || !ready}>
                  Сохранить в .cursor
                </button>
                <button type="button" onClick={() => setEditor(null)}>
                  Закрыть
                </button>
              </div>
            </form>
          ) : (
            <>
              <h2>Файл</h2>
              <p className="where">Откройте строку в списке или добавьте новую.</p>
            </>
          )}
        </section>
      </div>

      <section className="recommend-block" data-testid="recommendations">
        <h2>Рекомендации</h2>
        <article className="card recommend" data-testid="recommendation-machine-runs">
          <div className="recommend-head">
            <h3>{recommendation.title}</h3>
            <span className={recommendation.added ? 'pill on' : 'pill idle'} data-testid="recommendation-state">
              {recommendation.added ? 'Добавлено' : 'Выключено'}
            </span>
          </div>
          <p>{recommendation.text}</p>
          <div className="row-actions">
            <button
              type="button"
              className="primary"
              data-testid="add-recommendation"
              disabled={busy || !ready || recommendation.added}
              onClick={() => void addRecommendation()}
            >
              {recommendation.added ? 'Уже в .cursor' : 'Записать в .cursor'}
            </button>
          </div>
        </article>
      </section>
    </div>
  )
}
