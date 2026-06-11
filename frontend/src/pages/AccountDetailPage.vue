<template>
  <div>
    <h1>{{ t('accounts.title') }} #{{ route.params.id }}</h1>
    <p>{{ t('common.noData') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const { t } = useI18n()
const route = useRoute()
</script>
