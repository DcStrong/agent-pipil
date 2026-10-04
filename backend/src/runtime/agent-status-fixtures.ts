/**
 * Образцы вывода `agent status` / `agent status --format json` (без секретов).
 * Бинарник agent в CI может отсутствовать — фикстуры для регрессии разбора.
 */
export const AGENT_STATUS_TEXT_LOGGED_IN = '✓ Logged in as dev@example.com\n';

export const AGENT_STATUS_TEXT_WHOAMI = 'Logged in as cli@test.dev\n';

export const AGENT_STATUS_JSON_AUTHENTICATED = JSON.stringify({
  authenticated: true,
  email: 'dev@example.com',
});

export const AGENT_STATUS_JSON_LOGGED_IN_SNAKE = JSON.stringify({
  logged_in: true,
  user_email: 'dev@example.com',
});

export const AGENT_STATUS_JSON_STATUS_STRING = JSON.stringify({
  status: 'logged_in',
  account: { email: 'dev@example.com' },
});

export const AGENT_STATUS_JSON_UNKNOWN = JSON.stringify({
  version: '2026.1.0',
  channel: 'stable',
});
