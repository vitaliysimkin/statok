import { ref } from 'vue'

export type Theme = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'statok_theme'
const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
const current = ref<Theme>(saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto')

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'auto') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', resolve(theme))
}

let mql: MediaQueryList | null = null
let mqlHandler: (() => void) | null = null

function attachMediaListener() {
  if (mql && mqlHandler) {
    mql.removeEventListener('change', mqlHandler)
  }
  if (current.value === 'auto') {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mqlHandler = () => apply('auto')
    mql.addEventListener('change', mqlHandler)
  } else {
    mql = null
    mqlHandler = null
  }
}

// Bootstrap once on module load
apply(current.value)
attachMediaListener()

export function useTheme() {
  function applyTheme(theme: Theme) {
    current.value = theme
    localStorage.setItem(STORAGE_KEY, theme)
    apply(theme)
    attachMediaListener()
  }

  return { theme: current, applyTheme }
}
