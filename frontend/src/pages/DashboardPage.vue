<template>
  <div>
    <h1>{{ t('nav.dashboard') }}</h1>
    <p>{{ t('common.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
