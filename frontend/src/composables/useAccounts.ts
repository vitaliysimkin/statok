import { ref } from 'vue'
import { apiFetch } from '@/services/api'
import type {
  AccountWithBalances,
  CreateAccountRequest,
  UpdateAccountRequest,
} from '@statok/shared'

export function useAccounts() {
  const accounts = ref<AccountWithBalances[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function list(withBalances = false): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const qs = withBalances ? '?withBalances=true' : ''
      accounts.value = await apiFetch<AccountWithBalances[]>(`/api/accounts${qs}`)
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  async function get(id: string): Promise<AccountWithBalances> {
    return apiFetch<AccountWithBalances>(`/api/accounts/${id}`)
  }

  async function create(data: CreateAccountRequest): Promise<AccountWithBalances> {
    const account = await apiFetch<AccountWithBalances>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    accounts.value.push(account)
    return account
  }

  async function update(id: string, data: UpdateAccountRequest): Promise<AccountWithBalances> {
    const account = await apiFetch<AccountWithBalances>(`/api/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    const idx = accounts.value.findIndex((a) => a.id === id)
    if (idx !== -1) accounts.value[idx] = account
    return account
  }

  async function archive(id: string): Promise<AccountWithBalances> {
    return update(id, { archived: true })
  }

  return { accounts, loading, error, list, get, create, update, archive }
}
