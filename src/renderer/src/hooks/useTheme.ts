import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'dracula' | 'nord' | 'high-contrast' | 'system'

const STORAGE_KEY = 'passcode-theme'

function applyTheme(pref: ThemePreference): void {
  if (pref === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (isDark) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
    return
  }
  if (pref === 'light') {
    document.documentElement.removeAttribute('data-theme')
    return
  }
  document.documentElement.setAttribute('data-theme', pref)
}

export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system'
  )

  useEffect(() => {
    applyTheme(pref)
    if (pref !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (): void => applyTheme('system')
    mql.addEventListener('change', listener)
    return () => mql.removeEventListener('change', listener)
  }, [pref])

  function setTheme(next: ThemePreference): void {
    localStorage.setItem(STORAGE_KEY, next)
    setPref(next)
  }

  return [pref, setTheme]
}
