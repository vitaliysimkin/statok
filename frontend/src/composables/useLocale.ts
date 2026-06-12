import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type Locale = 'uk' | 'en'

const STORAGE_KEY = 'statok_locale'

function setHtmlLang(l: Locale) {
  document.documentElement.lang = l
}

// Keep <html lang> in sync from the persisted locale on first load (mirrors the
// fallback in i18n/index.ts), then setLocale updates it on every change.
const savedLocale = localStorage.getItem(STORAGE_KEY)
setHtmlLang(savedLocale === 'en' || savedLocale === 'uk' ? savedLocale : 'uk')

export function useLocale() {
  const { locale } = useI18n({ useScope: 'global' })
  const current = ref<Locale>(locale.value as Locale)

  function setLocale(l: Locale) {
    locale.value = l
    current.value = l
    localStorage.setItem(STORAGE_KEY, l)
    setHtmlLang(l)
  }

  return { locale: current, setLocale }
}
