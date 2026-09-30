export function taskTitle(task: string): string {
  const line = task.trim().split('\n')[0] ?? 'Task'
  return line.length > 84 ? `${line.slice(0, 83)}…` : line
}

export function firstSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const stop = trimmed.search(/[.!?]/)
  const sentence = stop === -1 ? trimmed : trimmed.slice(0, stop + 1)
  return sentence.length > 120 ? `${sentence.slice(0, 119)}…` : sentence
}

export function finalResultText(output: string): string {
  const marker = '## Final result'
  const index = output.lastIndexOf(marker)
  if (index === -1) return output.trim()
  const text = output.slice(index + marker.length).trim()
  return text || output.trim()
}

export function clock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function statusLine(run: {
  status: 'running' | 'completed' | 'failed'
  ownerName: string | null
  stageIndex: number | null
  stages: unknown[]
  error: string | null
} | null): string {
  if (!run) return 'No task on the board.'
  if (run.status === 'completed') return 'The run finished. The final result is ready.'
  if (run.status === 'failed') {
    const owner = run.ownerName ?? 'the current role'
    return `Stopped on ${owner}. ${run.error ?? ''}`.trim()
  }
  const index = (run.stageIndex ?? 0) + 1
  const owner = run.ownerName ?? 'An agent'
  return `${owner} owns this task. Stage ${index} of ${run.stages.length}.`
}
