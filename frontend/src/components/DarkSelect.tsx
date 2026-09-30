/** Тёмный список. Системное меню рисует чужую подсветку и здесь не используется. */
import { useEffect, useId, useRef, useState } from 'react'

export function DarkSelect({
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const label = options.find((item) => item.value === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dark-select" ref={root}>
      <button
        type="button"
        className="dark-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="dark-menu" id={listId} role="listbox">
          {options.map((item) => (
            <li key={item.value}>
              <button
                type="button"
                role="option"
                className={item.value === value ? 'menu-item is-on' : 'menu-item'}
                aria-selected={item.value === value}
                onClick={() => {
                  onChange(item.value)
                  setOpen(false)
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
