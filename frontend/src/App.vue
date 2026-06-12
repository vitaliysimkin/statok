<template>
  <div id="layout">
    <nav v-if="showNav" class="app-nav">
      <RouterLink to="/dashboard">{{ t('nav.dashboard') }}</RouterLink>
      <RouterLink to="/accounts">{{ t('nav.accounts') }}</RouterLink>
      <RouterLink to="/transactions">{{ t('nav.transactions') }}</RouterLink>
      <RouterLink to="/assets">{{ t('nav.assets') }}</RouterLink>
      <RouterLink to="/settings">{{ t('nav.settings') }}</RouterLink>
      <ThemeLocaleSwitcher class="nav-switcher" />
      <TButton
        class="nav-logout"
        mode="ghost"
        size="small"
        :label="t('nav.logout')"
        @click="logout"
      />
    </nav>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { TButton } from '@vitaliysimkin/t-components'
import ThemeLocaleSwitcher from '@/components/ThemeLocaleSwitcher.vue'
import { useAuth } from '@/composables/useAuth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { refresh } = useAuth()

const showNav = computed(() => route.meta.public !== true)

function logout() {
  localStorage.removeItem('statok_token')
  router.push('/login')
}

onMounted(() => {
  if (localStorage.getItem('statok_token')) {
    refresh().catch(() => {})
  }
})
</script>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}

#layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--color-nav-bg);
  align-items: center;
}

.app-nav a {
  color: var(--color-nav-text);
  text-decoration: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.app-nav a.router-link-active {
  color: var(--color-nav-active);
  background: var(--color-surface-hover);
}

.nav-logout {
  margin-left: auto;
}

.app-main {
  flex: 1;
  padding: 1rem;
}
</style>
