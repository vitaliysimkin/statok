import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type { NetWorthSeriesResponse, CashflowResponse } from '@statok/shared'

export function useDashboards() {
  const networthSeries = ref<NetWorthSeriesResponse | null>(null)
  const cashflow = ref<CashflowResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchNetworthSeries(params?: { from?: string; to?: string }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const q = qs.toString() ? `?${qs}` : ''
      networthSeries.value = await apiFetch<NetWorthSeriesResponse>(`/api/dashboards/networth-series${q}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function fetchCashflow(params?: {
    from?: string
    to?: string
    groupBy?: 'month' | 'quarter' | 'year'
  }): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      if (params?.groupBy) qs.set('groupBy', params.groupBy)
      const q = qs.toString() ? `?${qs}` : ''
      cashflow.value = await apiFetch<CashflowResponse>(`/api/dashboards/cashflow${q}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  return { networthSeries, cashflow, loading, error, fetchNetworthSeries, fetchCashflow }
}
