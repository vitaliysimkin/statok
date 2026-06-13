<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">Statok</h1>

      <!--
        Google Identity Services sign-in.
        Shown only when VITE_GOOGLE_CLIENT_ID is configured (prod). The GIS button is
        rendered into `googleButtonRef` after the external script loads (see onMounted).
      -->
      <div v-if="googleEnabled" class="login-google">
        <div ref="googleButtonRef" class="google-button" :aria-label="t('auth.signInWithGoogle')" />
        <p v-if="errorMsg" class="login-error" role="alert">{{ errorMsg }}</p>
      </div>

      <!--
        Break-glass / dev password form. Rendered out-of-box when no Google client id
        is set, so local dev (admin/admin) keeps working with zero configuration.
      -->
      <form v-else class="login-form" @submit.prevent="handleSubmit">
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
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { TInput, TButton } from '@vitaliysimkin/t-components'
import { useAuth } from '@/composables/useAuth'
import { ApiError, errKey } from '@/services/api'

// ── Minimal GIS typings (no @types package; the script is loaded at runtime) ──────
interface GoogleCredentialResponse {
  credential: string
}
interface GoogleIdConfig {
  client_id: string
  callback: (response: GoogleCredentialResponse) => void
}
interface GoogleButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  width?: number
}
interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void
}
interface GoogleGlobal {
  accounts: { id: GoogleAccountsId }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'

// VITE_GOOGLE_CLIENT_ID is not (yet) in ImportMetaEnv typings (src/env.d.ts is owned
// elsewhere); read it via a local cast. Empty/undefined → password fallback.
const googleClientId = (
  (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_CLIENT_ID ?? ''
).trim()
const googleEnabled = googleClientId.length > 0

const { t } = useI18n()
const router = useRouter()
const { login, loginWithGoogle } = useAuth()

const usernameInput = ref('')
const passwordInput = ref('')
const errorMsg = ref('')
const loading = ref(false)
const googleButtonRef = ref<HTMLElement | null>(null)

let scriptEl: HTMLScriptElement | null = null

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

async function onGoogleCredential(response: GoogleCredentialResponse) {
  errorMsg.value = ''
  loading.value = true
  try {
    await loginWithGoogle(response.credential)
    await router.push('/dashboard')
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      errorMsg.value = t('auth.forbidden')
    } else if (e instanceof ApiError && e.status === 503) {
      errorMsg.value = t('auth.notConfigured')
    } else {
      errorMsg.value = t(errKey(e))
    }
  } finally {
    loading.value = false
  }
}

function initGoogle() {
  const g = (window as unknown as { google?: GoogleGlobal }).google
  if (!g || !googleButtonRef.value) {
    errorMsg.value = t('auth.googleError')
    return
  }
  g.accounts.id.initialize({
    client_id: googleClientId,
    callback: onGoogleCredential,
  })
  g.accounts.id.renderButton(googleButtonRef.value, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'center',
    width: 280,
  })
}

onMounted(() => {
  if (!googleEnabled) return

  // Reuse an already-loaded GIS script if present (e.g. navigating back to /login).
  if ((window as unknown as { google?: GoogleGlobal }).google) {
    initGoogle()
    return
  }
  scriptEl = document.createElement('script')
  scriptEl.src = GIS_SRC
  scriptEl.async = true
  scriptEl.defer = true
  scriptEl.onload = initGoogle
  scriptEl.onerror = () => {
    errorMsg.value = t('auth.googleError')
  }
  document.head.appendChild(scriptEl)
})

onBeforeUnmount(() => {
  if (scriptEl && scriptEl.parentNode) {
    scriptEl.parentNode.removeChild(scriptEl)
  }
  scriptEl = null
})
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
.login-google {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}
.google-button {
  display: flex;
  justify-content: center;
  min-height: 40px;
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
  text-align: center;
}
</style>
