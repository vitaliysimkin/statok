<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">Statok</h1>
      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="field">
          <label for="username">{{ t('auth.username') }}</label>
          <TInput
            id="username"
            v-model="usernameInput"
            type="text"
            autocomplete="username"
            required
            :disabled="loading"
          />
        </div>
        <div class="field">
          <label for="password">{{ t('auth.password') }}</label>
          <TInput
            id="password"
            v-model="passwordInput"
            type="password"
            autocomplete="current-password"
            required
            :disabled="loading"
          />
        </div>
        <p v-if="errorMsg" class="login-error" role="alert">{{ errorMsg }}</p>
        <TButton
          type="submit"
          variant="accent"
          :disabled="loading"
          :label="loading ? t('common.loading') : t('auth.login')"
        />
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { TInput, TButton } from '@vitaliysimkin/t-components'
import { useAuth } from '@/composables/useAuth'
import { ApiError, errKey } from '@/services/api'

const { t } = useI18n()
const router = useRouter()
const { login } = useAuth()

const usernameInput = ref('')
const passwordInput = ref('')
const errorMsg = ref('')
const loading = ref(false)

async function handleSubmit() {
  errorMsg.value = ''
  loading.value = true
  try {
    await login(usernameInput.value, passwordInput.value)
    await router.push('/dashboard')
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      errorMsg.value = t('auth.loginError')
    } else {
      errorMsg.value = t(errKey(e))
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1rem;
}
.login-card {
  width: 100%;
  max-width: 360px;
  padding: 2rem;
  border-radius: 8px;
  background: var(--color-surface, #fff);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.12);
}
.login-title {
  margin: 0 0 1.5rem;
  text-align: center;
  font-size: 1.75rem;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field label {
  font-size: 0.875rem;
  font-weight: 500;
}
.login-error {
  margin: 0;
  color: var(--color-error, #dc2626);
  font-size: 0.875rem;
}
</style>
