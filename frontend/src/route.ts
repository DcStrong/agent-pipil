import { useEffect, useState } from 'react'

export type View = 'board' | 'roles' | 'skills' | 'pipeline'

function parseView(hash: string): View {
  const value = hash.replace(/^#\/?/, '')
  if (value === 'roles' || value === 'skills' || value === 'pipeline') return value
  return 'board'
}

export function useView(): View {
  const [view, setView] = useState<View>(() => parseView(window.location.hash))
  useEffect(() => {
    const onChange = () => setView(parseView(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return view
}
