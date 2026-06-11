import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type { FxRate, FxConvertResponse } from '@statok/shared'

export interface FxSyncResult {
  frankfurter: { ok: boolean; ratesUpserted: number }
  nbu: { ok: boolean; ratesUpserted: number }
}

export function useFx() {
  const rates = ref<FxRate[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function history(params?: {
    base?: string
    quote?: string
    from?: string
    to?: string
  }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (params?.base) qs.set('base', params.base)
      if (params?.quote) qs.set('quote', params.quote)
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const q = qs.toString() ? `?${qs}` : ''
      rates.value = await apiFetch<FxRate[]>(`/api/fx${q}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function convert(params: {
    amount: number
    from: string
    to: string
    date?: string
  }): Promise<FxConvertResponse> {
    const qs = new URLSearchParams()
    qs.set('amount', String(params.amount))
    qs.set('from', params.from)
    qs.set('to', params.to)
    if (params.date) qs.set('date', params.date)
    return apiFetch<FxConvertResponse>(`/api/fx/convert?${qs}`)
  }

  async function sync(): Promise<FxSyncResult> {
    return apiFetch<FxSyncResult>('/api/fx/sync', { method: 'POST' })
  }

  async function upsert(date: string, base: string, quote: string, rate: string): Promise<FxRate> {
    return apiFetch<FxRate>(`/api/fx/${date}/${base}/${quote}`, {
      method: 'PUT',
      body: JSON.stringify({ rate }),
    })
  }

  return { rates, loading, error, history, convert, sync, upsert }
}
