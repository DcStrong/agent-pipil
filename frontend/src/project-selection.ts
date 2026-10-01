const KEY = 'pipil-selected-project'

/** Id проекта из экрана «Проект» для POST /api/runs. */
export function selectedProjectIdForRun(): string | null {
  try {
    const id = sessionStorage.getItem(KEY)?.trim()
    return id || null
  } catch {
    return null
  }
}
