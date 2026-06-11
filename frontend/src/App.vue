<template>
  <div id="layout">
    <nav v-if="showNav" class="app-nav">
      <RouterLink to="/dashboard">{{ t('nav.dashboard') }}</RouterLink>
      <RouterLink to="/accounts">{{ t('nav.accounts') }}</RouterLink>
      <RouterLink to="/transactions">{{ t('nav.transactions') }}</RouterLink>
      <RouterLink to="/assets">{{ t('nav.assets') }}</RouterLink>
      <RouterLink to="/settings">{{ t('nav.settings') }}</RouterLink>
      <button class="nav-logout" @click="logout">{{ t('nav.logout') }}</button>
    </nav>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const showNav = computed(() => route.meta.public !== true)

function logout() {
  localStorage.removeItem('statok_token')
  router.push('/login')
}
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
  background: #1a1a2e;
  align-items: center;
}

.app-nav a {
  color: #ccc;
  text-decoration: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.app-nav a.router-link-active {
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}

.nav-logout {
  margin-left: auto;
  background: transparent;
  border: 1px solid #666;
  color: #ccc;
  cursor: pointer;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
}

.app-main {
  flex: 1;
  padding: 1rem;
}
</style>
