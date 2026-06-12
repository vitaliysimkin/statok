import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type { SettingsResponse } from '@statok/shared'

export function useSettings() {
  const settings = ref<SettingsResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchSettings(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      settings.value = await apiFetch<SettingsResponse>('/api/settings')
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function triggerSnapshotRun(date?: string): Promise<{ count?: number }> {
    return apiFetch<{ count?: number }>('/api/snapshots/run', {
      method: 'POST',
      body: JSON.stringify(date ? { date } : {}),
    })
  }

  async function triggerSnapshotRebuild(from: string, to: string): Promise<{ count: number }> {
    return apiFetch<{ count: number }>('/api/snapshots/rebuild', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    })
  }

  async function triggerPricesSync(assetId?: string): Promise<unknown> {
    return apiFetch('/api/prices/sync', {
      method: 'POST',
      body: JSON.stringify(assetId ? { assetId } : {}),
    })
  }

  async function triggerFxSync(): Promise<unknown> {
    return apiFetch('/api/fx/sync', { method: 'POST' })
  }

  return {
    settings,
    loading,
    error,
    fetchSettings,
    triggerSnapshotRun,
    triggerSnapshotRebuild,
    triggerPricesSync,
    triggerFxSync,
  }
}
