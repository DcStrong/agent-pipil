/** Вкладка для входа Cursor CLI: синхронный popup до await, затем переход на loginUrl. */

export type LoginTabNavigateResult = 'navigated' | 'already' | 'no-window' | 'closed'

export function openBlankLoginTab(): Window | null {
  try {
    const win = window.open('about:blank', '_blank', 'noopener,noreferrer')
    if (!win || win.closed) return null
    return win
  } catch {
    return null
  }
}

export function navigateLoginTab(
  tab: Window | null,
  url: string,
  openedUrl: string | null,
): LoginTabNavigateResult {
  if (openedUrl === url) return 'already'
  if (!tab || tab.closed) return tab ? 'closed' : 'no-window'
  try {
    tab.location.href = url
    return 'navigated'
  } catch {
    return 'no-window'
  }
}
