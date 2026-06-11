<template>
  <div>
    <h1>{{ t('accounts.title') }}</h1>
    <p>{{ t('common.noData') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
