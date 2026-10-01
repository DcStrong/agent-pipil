/** Тёмный список. Системное меню рисует чужую подсветку и здесь не используется. */
import { useEffect, useId, useRef, useState } from 'react'

interface MenuFrame {
  top: number
  left: number
  width: number
  maxHeight: number
  up: boolean
}

/** Список крепится к окну, а не к прокручиваемой панели: иначе пункты обрезаются и щелчок не выбирает строку. */
function readFrame(button: HTMLButtonElement): MenuFrame {
  const rect = button.getBoundingClientRect()
  const gap = 4
  const below = window.innerHeight - rect.bottom - gap
  const above = rect.top - gap
  const up = below < 180 && above > below
  return {
    top: up ? rect.top - gap : rect.bottom + gap,
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(120, Math.min(320, up ? above : below)),
    up,
  }
}

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
  const [frame, setFrame] = useState<MenuFrame | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const label = options.find((item) => item.value === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (root.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const hide = () => setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [open])

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    if (!button.current) return
    setFrame(readFrame(button.current))
    setOpen(true)
  }

  return (
    <div className="dark-select" ref={root}>
      <button
        ref={button}
        type="button"
        className="dark-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        data-testid={testId}
        onClick={toggle}
      >
        <span>{label}</span>
        <span className="dark-select-arrow" aria-hidden="true">▾</span>
      </button>
      {open && frame ? (
        <ul
          className={frame.up ? 'dark-menu is-up' : 'dark-menu'}
          id={listId}
          role="listbox"
          style={{
            top: frame.top,
            left: frame.left,
            width: frame.width,
            maxHeight: frame.maxHeight,
          }}
        >
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
