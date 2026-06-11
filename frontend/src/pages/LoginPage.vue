<template>
  <div class="login-page">
    <h1>Statok</h1>
    <p>{{ t('auth.login') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
