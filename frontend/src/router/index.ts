import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { public: true },
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/pages/DashboardPage.vue'),
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: () => import('@/pages/AccountsPage.vue'),
    },
    {
      path: '/accounts/:id',
      name: 'account-detail',
      component: () => import('@/pages/AccountDetailPage.vue'),
    },
    {
      path: '/transactions',
      name: 'transactions',
      component: () => import('@/pages/TransactionsPage.vue'),
    },
    {
      path: '/assets',
      name: 'assets',
      component: () => import('@/pages/AssetsPage.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/SettingsPage.vue'),
    },
  ],
})

router.beforeEach((to) => {
  const token = localStorage.getItem('statok_token')
  const isPublic = to.meta.public === true

  if (!isPublic && !token) {
    return { name: 'login' }
  }

  return true
})

export default router
