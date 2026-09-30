import { motion } from 'motion/react'
import { taskTitle } from '../format'
import type { Run } from '../types'

export function TaskCard({ run, reduced }: { run: Run; reduced: boolean }) {
  const label =
    run.status === 'completed'
      ? 'Finished'
      : run.status === 'failed'
        ? 'Stopped'
        : `${run.ownerName ?? 'Agent'} · working`

  return (
    <motion.article
      layoutId="pipeline-task"
      className={`task-card is-${run.status}`}
      transition={
        reduced ? { duration: 0 } : { type: 'spring', bounce: 0.16, duration: 0.7 }
      }
    >
      <p>{label}</p>
      <h3>{taskTitle(run.task)}</h3>
    </motion.article>
  )
}
