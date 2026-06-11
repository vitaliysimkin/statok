import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

export type Locale = 'uk' | 'en'

const STORAGE_KEY = 'statok_locale'

export function useLocale() {
  const { locale } = useI18n({ useScope: 'global' })
  const current = ref<Locale>(locale.value as Locale)

  function setLocale(l: Locale) {
    locale.value = l
    current.value = l
    localStorage.setItem(STORAGE_KEY, l)
  }

  return { locale: current, setLocale }
}
