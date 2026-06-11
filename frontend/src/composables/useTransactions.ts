import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type {
  TransactionListItem,
  TransactionListResponse,
  Transaction,
  CreateTransactionRequest,
  CreateTransferRequest,
  TickerChangeRequest,
} from '@statok/shared'

export interface TransactionFilters {
  accountId?: string
  assetId?: string
  type?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export function useTransactions() {
  const items = ref<TransactionListItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(filters: TransactionFilters = {}): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = new URLSearchParams()
      if (filters.accountId) qs.set('accountId', filters.accountId)
      if (filters.assetId) qs.set('assetId', filters.assetId)
      if (filters.type) qs.set('type', filters.type)
      if (filters.from) qs.set('from', filters.from)
      if (filters.to) qs.set('to', filters.to)
      if (filters.limit !== undefined) qs.set('limit', String(filters.limit))
      if (filters.offset !== undefined) qs.set('offset', String(filters.offset))
      const q = qs.toString() ? `?${qs}` : ''
      const res = await apiFetch<TransactionListResponse>(`/api/transactions${q}`)
      items.value = res.items
      total.value = res.total
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function get(id: string): Promise<Transaction> {
    const res = await apiFetch<{ transaction: Transaction }>(`/api/transactions/${id}`)
    return res.transaction
  }

  async function create(data: CreateTransactionRequest): Promise<Transaction> {
    const res = await apiFetch<{ transaction: Transaction }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return res.transaction
  }

  async function createTransfer(data: CreateTransferRequest): Promise<void> {
    await apiFetch('/api/transactions/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function tickerChange(data: TickerChangeRequest): Promise<void> {
    await apiFetch('/api/transactions/ticker-change', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async function update(id: string, data: Partial<CreateTransactionRequest>): Promise<Transaction> {
    const res = await apiFetch<{ transaction: Transaction }>(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    return res.transaction
  }

  async function remove(id: string): Promise<void> {
    await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' })
  }

  return { items, total, loading, error, list, get, create, createTransfer, tickerChange, update, remove }
}
