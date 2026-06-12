import router from '@/router'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3100'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Maps a caught error to an i18n key under `errors.*`, e.g. `t(errKey(e))`.
 * ApiError → `errors.<MACHINE_CODE>`; anything else → `errors.UNKNOWN`.
 */
export function errKey(e: unknown): string {
  return e instanceof ApiError ? `errors.${e.code}` : 'errors.UNKNOWN'
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem('statok_token')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  })

  if (response.status === 401) {
    localStorage.removeItem('statok_token')
    await router.push('/login')
    throw new ApiError(401, 'UNAUTHORIZED', 'Unauthorized')
  }

  if (!response.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      code = body.error ?? code
      message = body.message ?? message
    } catch {
      // ignore parse error
    }
    throw new ApiError(response.status, code, message)
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}
