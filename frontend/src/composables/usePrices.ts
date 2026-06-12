import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type { PriceQuote } from '@statok/shared'

export interface PriceSyncResult {
  okCount: number
  errCount: number
  errors: Array<{ symbol: string; message: string }>
}

export function usePrices() {
  const quotes = ref<PriceQuote[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function history(params: {
    assetId: string
    from?: string
    to?: string
  }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      qs.set('assetId', params.assetId)
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      const res = await apiFetch<{ items: PriceQuote[] }>(`/api/prices?${qs}`)
      quotes.value = res.items
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function upsert(assetId: string, date: string, price: string): Promise<PriceQuote> {
    return apiFetch<PriceQuote>(`/api/prices/${assetId}/${date}`, {
      method: 'PUT',
      body: JSON.stringify({ price }),
    })
  }

  async function remove(assetId: string, date: string): Promise<void> {
    await apiFetch(`/api/prices/${assetId}/${date}`, { method: 'DELETE' })
  }

  async function sync(assetId?: string): Promise<PriceSyncResult> {
    return apiFetch<PriceSyncResult>('/api/prices/sync', {
      method: 'POST',
      body: JSON.stringify(assetId ? { assetId } : {}),
    })
  }

  return { quotes, loading, error, history, upsert, remove, sync }
}
