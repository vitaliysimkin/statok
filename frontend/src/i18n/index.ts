import { createI18n } from 'vue-i18n'
import uk from '@/locales/uk.json'
import en from '@/locales/en.json'

const savedLocale = localStorage.getItem('statok_locale')
const locale = (savedLocale === 'en' || savedLocale === 'uk') ? savedLocale : 'uk'

const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: 'en',
  messages: {
    uk,
    en,
  },
})

export default i18n
