import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type {
  Asset,
  CreateAssetRequest,
  UpdateAssetRequest,
  BondSchedule,
  BondMetrics,
} from '@statok/shared'

export function useAssets() {
  const assets = ref<Asset[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(params?: { type?: string; archived?: boolean }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (params?.type) qs.set('type', params.type)
      if (params?.archived !== undefined) qs.set('archived', String(params.archived))
      const q = qs.toString() ? `?${qs}` : ''
      assets.value = await apiFetch<Asset[]>(`/api/assets${q}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function get(id: string): Promise<Asset> {
    return apiFetch<Asset>(`/api/assets/${id}`)
  }

  async function create(data: CreateAssetRequest): Promise<Asset> {
    const asset = await apiFetch<Asset>('/api/assets', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    assets.value.push(asset)
    return asset
  }

  async function update(id: string, data: UpdateAssetRequest): Promise<Asset> {
    const asset = await apiFetch<Asset>(`/api/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    const idx = assets.value.findIndex((a) => a.id === id)
    if (idx !== -1) assets.value[idx] = asset
    return asset
  }

  async function archive(id: string): Promise<Asset> {
    return update(id, { archived: true })
  }

  async function bondSchedule(id: string): Promise<BondSchedule> {
    return apiFetch<BondSchedule>(`/api/assets/${id}/bond/schedule`)
  }

  async function bondMetrics(id: string, params?: { price?: string; date?: string }): Promise<BondMetrics> {
    const qs = new URLSearchParams()
    if (params?.price) qs.set('price', params.price)
    if (params?.date) qs.set('date', params.date)
    const q = qs.toString() ? `?${qs}` : ''
    return apiFetch<BondMetrics>(`/api/assets/${id}/bond/metrics${q}`)
  }

  return { assets, loading, error, list, get, create, update, archive, bondSchedule, bondMetrics }
}
