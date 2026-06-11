<template>
  <div class="tls">
    <button
      class="tls-btn"
      :title="t('settings.language')"
      :aria-label="t('settings.language')"
      @click="toggleLocale"
    >
      <span class="tls-label" aria-hidden="true">{{ locale === 'uk' ? 'UK' : 'EN' }}</span>
    </button>
    <button
      class="tls-btn"
      :title="t('settings.theme')"
      :aria-label="t('settings.theme')"
      @click="cycleTheme"
    >
      <span class="tls-label tls-icon" aria-hidden="true">{{ themeIcon }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'

const { t } = useI18n()
const { theme, applyTheme } = useTheme()
const { locale, setLocale } = useLocale()

const THEME_CYCLE = ['light', 'dark', 'auto'] as const

const themeIcon = computed(() => {
  if (theme.value === 'light') return '☀'
  if (theme.value === 'dark') return '☾'
  return '⊙'
})

function cycleTheme() {
  const idx = THEME_CYCLE.indexOf(theme.value)
  applyTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length])
}

function toggleLocale() {
  setLocale(locale.value === 'uk' ? 'en' : 'uk')
}
</script>

<style scoped>
.tls {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.tls-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #ccc;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.8rem;
  line-height: 1.2;
  transition: color 0.15s, border-color 0.15s;
}

.tls-btn:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.6);
}

.tls-icon {
  font-size: 0.9rem;
}
</style>
