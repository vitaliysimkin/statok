import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type { PositionsResponse, ValuationResponse, PnlResponse } from '@statok/shared'

export function usePortfolio() {
  const positions = ref<PositionsResponse | null>(null)
  const valuation = ref<ValuationResponse | null>(null)
  const pnl = ref<PnlResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchPositions(params?: { accountId?: string; date?: string }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (params?.accountId) qs.set('accountId', params.accountId)
      if (params?.date) qs.set('date', params.date)
      const q = qs.toString() ? `?${qs}` : ''
      positions.value = await apiFetch<PositionsResponse>(`/api/portfolio/positions${q}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function fetchValuation(params?: { date?: string }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = params?.date ? `?date=${params.date}` : ''
      valuation.value = await apiFetch<ValuationResponse>(`/api/portfolio/valuation${qs}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function fetchPnl(params?: { accountId?: string; from?: string; to?: string }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (params?.accountId) qs.set('accountId', params.accountId)
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const q = qs.toString() ? `?${qs}` : ''
      pnl.value = await apiFetch<PnlResponse>(`/api/portfolio/pnl${q}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  return { positions, valuation, pnl, loading, error, fetchPositions, fetchValuation, fetchPnl }
}
