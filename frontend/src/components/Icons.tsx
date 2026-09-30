import type { ReactNode } from 'react'

type IconProps = { className?: string }

function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      {children}
    </svg>
  )
}

export function IconNodes({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="7" cy="7" r="2.1" />
      <circle cx="17" cy="7" r="2.1" />
      <circle cx="12" cy="17" r="2.1" />
      <path d="M8.7 8.5 10.8 15.1M15.3 8.5 13.2 15.1" />
    </Svg>
  )
}

export function IconRuns({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 7h11M8 12h11M8 17h7" />
      <circle cx="5" cy="7" r="0.8" fill="currentColor" />
      <circle cx="5" cy="12" r="0.8" fill="currentColor" />
      <circle cx="5" cy="17" r="0.8" fill="currentColor" />
    </Svg>
  )
}

export function IconAgent({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3.5 19 7.5v9L12 20.5 5 16.5v-9L12 3.5Z" />
      <path d="M12 12.2 19 8M12 12.2 5 8M12 12.2v8" />
    </Svg>
  )
}

export function IconGear({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.8 6.8l1.6 1.6M17.6 15.6l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.2l1.6-1.6M17.6 8.4l1.6-1.6" />
    </Svg>
  )
}

export function IconBoard({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="9.75" y="4" width="4.5" height="11" rx="1.2" />
      <rect x="16" y="4" width="4.5" height="14" rx="1.2" />
    </Svg>
  )
}

export function IconPlus({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconClose({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function IconCheck({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.6 12.2 2.3 2.3 4.5-5" />
    </Svg>
  )
}

export function IconSpark({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3.2 13.4 9 19 10.4 13.4 11.8 12 17.6 10.6 11.8 5 10.4 10.6 9 12 3.2Z" />
    </Svg>
  )
}
