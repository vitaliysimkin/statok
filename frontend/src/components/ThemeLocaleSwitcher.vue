<template>
  <div class="tls">
    <TButton
      class="tls-btn"
      mode="ghost"
      size="small"
      :label="locale === 'uk' ? 'UK' : 'EN'"
      :title="t('settings.language')"
      :aria-label="t('settings.language')"
      @click="toggleLocale"
    />
    <TButton
      class="tls-btn"
      mode="ghost"
      size="small"
      :icon="themeIcon"
      :title="themeLabel"
      :aria-label="themeLabel"
      @click="cycleTheme"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButton } from '@vitaliysimkin/t-components'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'

const { t } = useI18n()
const { theme, applyTheme } = useTheme()
const { locale, setLocale } = useLocale()

const THEME_CYCLE = ['light', 'dark', 'auto'] as const

const themeIcon = computed(() => {
  if (theme.value === 'light') return 'system-uicons:sun'
  if (theme.value === 'dark') return 'system-uicons:moon'
  return 'system-uicons:circle-split'
})

const themeLabel = computed(() => {
  if (theme.value === 'light') return t('settings.themeLight')
  if (theme.value === 'dark') return t('settings.themeDark')
  return t('settings.themeAuto')
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
</style>
