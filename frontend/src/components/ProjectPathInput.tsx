import { useState } from 'react'
import { api, messageOf } from '../api'
import type { SavedProjectKind } from '../types'

type Props = {
  kind: SavedProjectKind
  value: string
  onChange: (path: string) => void
  placeholder?: string
  pathTestId?: string
  pickTestId?: string
  disabled?: boolean
  onPickError?: (message: string) => void
}

export function ProjectPathInput({
  kind,
  value,
  onChange,
  placeholder = 'Путь на этой машине',
  pathTestId,
  pickTestId = 'pick-project-path',
  disabled,
  onPickError,
}: Props) {
  const [picking, setPicking] = useState(false)

  async function pick() {
    setPicking(true)
    try {
      const result = await api.pickProjectPath({ kind })
      if ('path' in result && result.path) onChange(result.path)
    } catch (reason) {
      onPickError?.(messageOf(reason))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="path-input-row">
      <input
        data-testid={pathTestId}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled || picking}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="path-pick-btn"
        data-testid={pickTestId}
        disabled={disabled || picking}
        onClick={() => void pick()}
      >
        {picking ? '…' : 'Выбрать'}
      </button>
    </div>
  )
}
