import type { DialogueMessage, RunStatus } from '../types'

/** Реплики роли и компактный след CLI: файлы, поиск, команды. */
export function DialogueLines({
  messages,
  running,
}: {
  messages: DialogueMessage[]
  running: boolean
}) {
  if (messages.length === 0) {
    return (
      <p className="hint" data-testid="dialogue-empty">
        {running ? 'Агент работает…' : 'Реплик пока нет. Это диалог выбранной роли.'}
      </p>
    )
  }
  return (
    <>
      {messages.map((message) =>
        message.author === 'trace' ? (
          <p key={message.id} className="trace-line" data-testid="trace-line">
            {message.text}
          </p>
        ) : (
          <p key={message.id} className={`bubble ${message.author}`}>
            {message.text}
          </p>
        ),
      )}
    </>
  )
}

export function dialogueIsRunning(status: RunStatus | undefined, stepIsCurrent: boolean): boolean {
  return status === 'running' && stepIsCurrent
}
