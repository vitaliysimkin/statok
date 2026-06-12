import type { Ref } from 'vue'
import { applyTheme as kitApplyTheme, currentTheme as kitTheme } from '@vitaliysimkin/t-components'

export type Theme = 'light' | 'dark' | 'auto'

// Single theme mechanism: the kit owns class toggling (.light/.dark on <html>),
// persistence to its own key, and the prefers-color-scheme listener for 'auto'.
// We keep 'statok_theme' as the app's source of truth and seed the kit from it on
// bootstrap, so the kit's currentTheme ref (and its own key) never drift from ours.
const STORAGE_KEY = 'statok_theme'

const theme = kitTheme as Ref<Theme>

function setTheme(next: Theme) {
  localStorage.setItem(STORAGE_KEY, next)
  // Assigning the kit ref persists the kit's key, repaints the class, and keeps
  // its matchMedia('auto') handler tracking the right value — one mechanism.
  theme.value = next
}

// Bootstrap once on module load from our key, overriding whatever the kit read.
const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
const initial: Theme = saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto'
setTheme(initial)
kitApplyTheme(initial)

export function useTheme() {
  return { theme, applyTheme: setTheme }
}
