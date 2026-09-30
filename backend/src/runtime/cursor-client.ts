/**
 * Отдельный клиент Cursor.
 * В этой версии метод не делает HTTP-запрос: разработка не должна тратить аккаунт.
 * Оркестратор вызывает его только если явно включён CURSOR_LIVE=1, и тогда шаг
 * завершается ошибкой, а не сетевым вызовом.
 */
export class CursorClient {
  liveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.CURSOR_LIVE === '1';
  }

  runStep(): Promise<never> {
    return Promise.reject(
      new Error(
        'Живой вызов Cursor в этой версии отключён. Запуски идут через имитацию и не тратят аккаунт.',
      ),
    );
  }
}
