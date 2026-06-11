<template>
  <div class="accounts-page">
    <div class="page-header">
      <h1>{{ t('accounts.title') }}</h1>
      <button class="btn-primary" @click="openCreate">
        <span class="icon">+</span> {{ t('accounts.newAccount') }}
      </button>
    </div>

    <div v-if="loading" class="loading">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="error">{{ t('common.error') }}: {{ error }}</div>

    <template v-else>
      <!-- Net worth summary -->
      <div class="net-worth-card">
        <div class="nw-label">{{ t('accounts.totalNetWorth') }}</div>
        <div class="nw-value">{{ totalNetWorth }}</div>
        <div v-if="anyIncomplete" class="nw-warn">{{ t('accounts.valuationIncomplete') }}</div>
      </div>

      <!-- Account list -->
      <div v-if="accounts.length === 0" class="empty-state">{{ t('accounts.noAccounts') }}</div>
      <div v-else class="account-list">
        <div
          v-for="acc in accounts"
          :key="acc.id"
          class="account-card"
          role="button"
          tabindex="0"
          :aria-label="acc.name"
          @click="goDetail(acc.id)"
          @keydown.enter.space.prevent="goDetail(acc.id)"
        >
          <div class="card-main">
            <div class="acc-name">{{ acc.name }}</div>
            <div class="acc-kind">{{ kindLabel(acc.kind) }}</div>
            <div v-if="acc.note" class="acc-note">{{ acc.note }}</div>
          </div>

          <div class="card-right">
            <!-- Per-currency cash balances -->
            <div v-if="acc.balances && acc.balances.length" class="balances">
              <div
                v-for="b in acc.balances"
                :key="b.currency"
                class="balance-row"
                :class="{ 'balance-neg': b.cashMinor < 0 }"
              >
                <span v-if="b.cashMinor < 0" class="warn-icon" :title="t('accounts.negativeCashWarning')">!</span>
                {{ formatMoney(b.cashMinor, b.currency, locale) }}
              </div>
            </div>

            <!-- Total value in base currency -->
            <div v-if="acc.valueBaseMinor != null" class="acc-value">
              {{ formatMoney(acc.valueBaseMinor, baseCcy, locale) }}
              <div v-if="acc.valuationIncomplete" class="val-incomplete-badge">~</div>
            </div>

            <!-- Actions -->
            <div class="card-actions" @click.stop>
              <button class="btn-icon" :title="t('common.edit')" :aria-label="t('common.edit')" @click.stop="openEdit(acc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon" :title="t('accounts.archiveAccount')" :aria-label="t('accounts.archiveAccount')" @click.stop="doArchive(acc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
              </button>
              <button class="btn-icon btn-danger" :title="t('accounts.deleteAccount')" :aria-label="t('accounts.deleteAccount')" @click.stop="doDelete(acc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Include archived toggle -->
      <div class="archived-toggle">
        <label class="toggle-label">
          <input type="checkbox" v-model="includeArchived" @change="reload" />
          {{ t('accounts.includeArchived') }}
        </label>
      </div>
    </template>

    <!-- Confirm dialog -->
    <div v-if="confirm.visible" class="confirm-overlay" role="dialog" aria-modal="true" :aria-label="confirm.message" @click.self="confirm.visible = false">
      <div class="confirm-dialog">
        <p id="confirm-msg">{{ confirm.message }}</p>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="confirm.visible = false">{{ t('common.cancel') }}</button>
          <button class="btn-danger-solid" @click="confirm.onOk">{{ t('common.confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- Account form modal -->
    <AccountForm
      v-if="formVisible"
      :account="editingAccount"
      @saved="onFormSaved"
      @cancel="formVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatMoney } from '@statok/shared'
import { useAccounts } from '@/composables/useAccounts'
import AccountForm from '@/components/accounts/AccountForm.vue'
import { apiFetch } from '@/services/api'
import type { AccountWithBalances } from '@statok/shared'

const { t, locale } = useI18n()
const router = useRouter()
const { accounts, loading, error, archive } = useAccounts()

const includeArchived = ref(false)
const formVisible = ref(false)
const editingAccount = ref<AccountWithBalances | null>(null)
const baseCcy = ref('USD')

const confirm = reactive({
  visible: false,
  message: '',
  onOk: () => {},
})

async function reload() {
  loading.value = true
  error.value = null
  try {
    const qs = `?withBalances=true${includeArchived.value ? '&includeArchived=true' : ''}`
    accounts.value = await apiFetch<AccountWithBalances[]>(`/api/accounts${qs}`)
  } catch (e: any) {
    error.value = e?.message ?? t('common.error')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await reload()
  try {
    const s = await apiFetch<{ baseCurrency: string }>('/api/settings')
    baseCcy.value = s.baseCurrency
  } catch {}
})

const anyIncomplete = computed(() => accounts.value.some((a) => a.valuationIncomplete))

const totalNetWorth = computed(() => {
  const total = accounts.value.reduce((sum, a) => sum + (a.valueBaseMinor ?? 0), 0)
  return formatMoney(total, baseCcy.value, locale.value)
})

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    broker: t('accounts.kindBroker'),
    bank: t('accounts.kindBank'),
    wallet: t('common.unknown'),
    exchange: t('common.unknown'),
    other: t('accounts.kindCash'),
  }
  return map[kind] ?? kind
}

function goDetail(id: string) {
  router.push(`/accounts/${id}`)
}

function openCreate() {
  editingAccount.value = null
  formVisible.value = true
}

function openEdit(acc: AccountWithBalances) {
  editingAccount.value = acc
  formVisible.value = true
}

async function onFormSaved(_acc: AccountWithBalances) {
  formVisible.value = false
  await reload()
}

function doArchive(acc: AccountWithBalances) {
  confirm.message = t('accounts.archiveConfirm', { name: acc.name })
  confirm.visible = true
  confirm.onOk = async () => {
    confirm.visible = false
    try {
      await archive(acc.id)
      await reload()
    } catch (e: any) {
      alert(e?.message)
    }
  }
}

function doDelete(acc: AccountWithBalances) {
  confirm.message = t('accounts.deleteConfirm', { name: acc.name })
  confirm.visible = true
  confirm.onOk = async () => {
    confirm.visible = false
    try {
      await apiFetch(`/api/accounts/${acc.id}`, { method: 'DELETE' })
      await reload()
    } catch (e: any) {
      alert(e?.message)
    }
  }
}
</script>

<style scoped>
.accounts-page {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}

.page-header h1 {
  margin: 0;
  font-size: 1.4rem;
}

.net-worth-card {
  background: var(--color-surface, #f8f9fa);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.25rem;
}

.nw-label {
  font-size: 0.8rem;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.nw-value {
  font-size: 1.75rem;
  font-weight: 700;
  margin-top: 0.25rem;
}

.nw-warn {
  font-size: 0.8rem;
  color: #92400e;
  margin-top: 0.25rem;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.account-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
  background: var(--color-surface, #fff);
}

.account-card:hover {
  border-color: #2563eb;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.acc-name {
  font-weight: 600;
  font-size: 1rem;
}

.acc-kind {
  font-size: 0.78rem;
  opacity: 0.55;
  margin-top: 1px;
}

.acc-note {
  font-size: 0.82rem;
  opacity: 0.6;
  margin-top: 3px;
}

.card-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.375rem;
  flex-shrink: 0;
}

.balances {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.balance-row {
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 4px;
}

.balance-neg {
  color: #dc2626;
}

.warn-icon {
  font-size: 0.7rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 50%;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  cursor: help;
}

.acc-value {
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.val-incomplete-badge {
  font-size: 0.75rem;
  opacity: 0.55;
  font-weight: 400;
  cursor: help;
}

.card-actions {
  display: flex;
  gap: 0.25rem;
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
}

.btn-icon:hover {
  opacity: 1;
}

.btn-danger {
  color: #dc2626;
}

.archived-toggle {
  margin-top: 1rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
  opacity: 0.7;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  opacity: 0.45;
}

.loading,
.error {
  padding: 2rem;
  text-align: center;
  opacity: 0.6;
}

.error {
  color: #dc2626;
  opacity: 1;
}

.btn-primary {
  padding: 0.45rem 1.1rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Confirm dialog */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
}

.confirm-dialog {
  background: var(--color-surface, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

.btn-secondary {
  padding: 0.45rem 1rem;
  background: transparent;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
  color: inherit;
}

.btn-danger-solid {
  padding: 0.45rem 1rem;
  background: #dc2626;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

/* Responsive 360px */
@media (max-width: 480px) {
  .account-card {
    flex-direction: column;
  }

  .card-right {
    align-items: flex-start;
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
  }

  .balances {
    align-items: flex-start;
  }

  .nw-value {
    font-size: 1.4rem;
  }
}
</style>
