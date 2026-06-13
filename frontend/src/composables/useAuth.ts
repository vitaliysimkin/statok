import { ref } from 'vue'
import { apiFetch, ApiError } from '@/services/api'
import router from '@/router'
import type { LoginRequest, LoginResponse, MeResponse, GoogleLoginRequest } from '@statok/shared'

const username = ref<string | null>(null)
const isAuthenticated = ref<boolean>(!!localStorage.getItem('statok_token'))

export function useAuth() {
  async function login(user: string, password: string): Promise<void> {
    const body: LoginRequest = { username: user, password }
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    localStorage.setItem('statok_token', res.token)
    username.value = res.username
    isAuthenticated.value = true
  }

  /**
   * Exchange a Google Identity Services ID token (`response.credential`) for the
   * app's own statok JWT via `POST /auth/google`. The Google ID token is sent once
   * and never stored — only the returned statok token persists (same key as `login`).
   */
  async function loginWithGoogle(credential: string): Promise<void> {
    const body: GoogleLoginRequest = { credential }
    const res = await apiFetch<LoginResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    localStorage.setItem('statok_token', res.token)
    username.value = res.username
    isAuthenticated.value = true
  }

  async function refresh(): Promise<void> {
    const token = localStorage.getItem('statok_token')
    if (!token) {
      isAuthenticated.value = false
      return
    }
    try {
      const res = await apiFetch<LoginResponse>('/auth/refresh', { method: 'POST' })
      localStorage.setItem('statok_token', res.token)
      username.value = res.username
      isAuthenticated.value = true
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        localStorage.removeItem('statok_token')
        isAuthenticated.value = false
      }
    }
  }

  async function me(): Promise<MeResponse | null> {
    try {
      const res = await apiFetch<MeResponse>('/auth/me')
      username.value = res.username
      return res
    } catch {
      return null
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // ignore errors, always clear local state
    }
    localStorage.removeItem('statok_token')
    username.value = null
    isAuthenticated.value = false
    await router.push('/login')
  }

  return { username, isAuthenticated, login, loginWithGoogle, refresh, me, logout }
}
