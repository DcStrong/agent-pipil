/** Вкладка для входа Cursor CLI: синхронный popup до await, затем переход на loginUrl. */

export type LoginTabNavigateResult = 'navigated' | 'already' | 'no-window' | 'closed'

/**
 * Открываем about:blank в жесте клика, чтобы обойти popup-blocker.
 * Без noopener/noreferrer: иначе браузер открывает вкладку, но window.open
 * возвращает null — перейти на loginUrl уже нельзя, остаётся белый экран.
 */
export function openBlankLoginTab(): Window | null {
  try {
    const win = window.open('about:blank', '_blank')
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
    // Пока вкладка same-origin (about:blank), отключаем opener до ухода на cursor.com.
    try {
      tab.opener = null
    } catch {
      // ignore
    }
    tab.location.href = url
    return 'navigated'
  } catch {
    return 'no-window'
  }
}
