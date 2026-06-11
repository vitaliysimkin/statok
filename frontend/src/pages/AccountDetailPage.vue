<template>
  <div class="account-detail-page">
    <!-- Back -->
    <div class="page-back">
      <RouterLink to="/accounts">&#8592; {{ t('common.back') }}</RouterLink>
    </div>

    <div v-if="loadingAccount" class="loading">{{ t('common.loading') }}</div>
    <div v-else-if="accountError" class="error">{{ accountError }}</div>

    <template v-else-if="account">
      <!-- Header -->
      <div class="detail-header">
        <div>
          <h1>{{ account.name }}</h1>
          <div class="acc-kind">{{ kindLabel(account.kind) }}</div>
          <div v-if="account.note" class="acc-note">{{ account.note }}</div>
        </div>
        <div class="header-actions">
          <button class="btn-secondary" @click="openEdit">{{ t('common.edit') }}</button>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="quick-actions">
        <button class="btn-action" @click="openTxForm('deposit')">
          + {{ t('accountDetail.addTransaction') }}
        </button>
        <button class="btn-action-outline" @click="openTxForm('opening_balance')">
          {{ t('accountDetail.addOpeningBalance') }}
        </button>
      </div>

      <!-- Cash balances -->
      <section class="section">
        <h2 class="section-title">{{ t('accountDetail.cashBalances') }}</h2>
        <div v-if="cashBalances.length === 0" class="empty-section">{{ t('accountDetail.noCash') }}</div>
        <div v-else class="cash-grid">
          <div
            v-for="b in cashBalances"
            :key="b.currency"
            class="cash-card"
            :class="{ 'cash-neg': b.balanceMinor < 0 }"
          >
            <div class="cash-ccy">{{ b.currency }}</div>
            <div class="cash-amount">
              <span v-if="b.balanceMinor < 0" class="warn-icon" :title="t('accounts.negativeCashWarning')">!</span>
              {{ formatMoney(b.balanceMinor, b.currency, locale) }}
            </div>
          </div>
        </div>
      </section>

      <!-- Positions -->
      <section class="section">
        <h2 class="section-title">{{ t('accountDetail.positions') }}</h2>
        <div v-if="loadingPositions" class="loading-sm">{{ t('common.loading') }}</div>
        <AccountPositionsTable v-else :positions="accountPositions" />
      </section>

      <!-- Transactions journal -->
      <section class="section">
        <h2 class="section-title">{{ t('accountDetail.transactions') }}</h2>
        <div v-if="loadingTx" class="loading-sm">{{ t('common.loading') }}</div>
        <div v-else>
          <div v-if="txItems.length === 0" class="empty-section">{{ t('transactions.noTransactions') }}</div>
          <div v-else class="tx-list">
            <div v-for="tx in txItems" :key="tx.id" class="tx-row">
              <div class="tx-main">
                <span class="tx-type">{{ txTypeLabel(tx.type) }}</span>
                <span class="tx-asset">{{ tx.assetSymbol }}</span>
                <span class="tx-date">{{ formatDate(tx.executedAt) }}</span>
              </div>
              <div class="tx-right">
                <span v-if="tx.amountMinor != null" class="tx-amount">
                  {{ formatMoney(tx.amountMinor, tx.currency, locale) }}
                </span>
                <span v-else-if="tx.grossMinor != null" class="tx-amount">
                  {{ formatMoney(tx.grossMinor, tx.currency, locale) }}
                </span>
                <span v-if="tx.quantity" class="tx-qty">× {{ tx.quantity }}</span>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div v-if="txTotal > txLimit" class="tx-pagination">
            <button class="btn-page" :disabled="txOffset === 0" :aria-label="t('common.prevPage')" @click="prevPage">&#8592;</button>
            <span class="page-info" aria-live="polite">
              {{ Math.floor(txOffset / txLimit) + 1 }} / {{ Math.ceil(txTotal / txLimit) }}
            </span>
            <button class="btn-page" :disabled="txOffset + txLimit >= txTotal" :aria-label="t('common.nextPage')" @click="nextPage">&#8594;</button>
          </div>
        </div>
      </section>
    </template>

    <!-- Edit form -->
    <AccountForm
      v-if="formVisible && account"
      :account="account"
      @saved="onFormSaved"
      @cancel="formVisible = false"
    />

    <!-- Quick TX form (simplified: just redirect to /transactions with pre-fill via state) -->
    <div v-if="txFormVisible" class="confirm-overlay" role="dialog" aria-modal="true" :aria-labelledby="'qtf-title'" @click.self="txFormVisible = false">
      <div class="tx-quick-form">
        <h3 id="qtf-title">{{ txFormType === 'opening_balance' ? t('accountDetail.addOpeningBalance') : t('accountDetail.addTransaction') }}</h3>
        <form @submit.prevent="submitQuickTx" novalidate>
          <div class="field">
            <label for="qtf-ccy">{{ t('transactions.currency') }}</label>
            <input
              id="qtf-ccy"
              v-model="qForm.currency"
              required
              maxlength="3"
              placeholder="USD"
              :aria-invalid="!!qFormError"
              :aria-describedby="qFormError ? 'qtf-error' : undefined"
            />
          </div>
          <div class="field">
            <label for="qtf-amount">{{ t('common.amount') }}</label>
            <input id="qtf-amount" v-model="qForm.amount" type="number" step="0.01" min="0" required />
          </div>
          <div class="field">
            <label for="qtf-date">{{ t('common.date') }}</label>
            <input id="qtf-date" v-model="qForm.date" type="datetime-local" required />
          </div>
          <div v-if="qFormError" id="qtf-error" class="form-error" role="alert">{{ qFormError }}</div>
          <div class="form-actions">
            <button type="button" class="btn-secondary" @click="txFormVisible = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn-primary" :disabled="qFormSaving">
              {{ qFormSaving ? t('common.loading') : t('common.save') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatMoney, displayToMinor } from '@statok/shared'
import { useAccounts } from '@/composables/useAccounts'
import { usePortfolio } from '@/composables/usePortfolio'
import { useTransactions } from '@/composables/useTransactions'
import AccountForm from '@/components/accounts/AccountForm.vue'
import AccountPositionsTable from '@/components/accounts/AccountPositionsTable.vue'
import { apiFetch } from '@/services/api'
import type { AccountWithBalances } from '@statok/shared'

const route = useRoute()
const { t, locale } = useI18n()
const { get: getAccount } = useAccounts()
const { positions: positionsData, fetchPositions } = usePortfolio()
const { items: txItems, total: txTotal, loading: loadingTx, list: listTx } = useTransactions()

const accountId = computed(() => route.params.id as string)
const account = ref<AccountWithBalances | null>(null)
const loadingAccount = ref(false)
const accountError = ref('')
const loadingPositions = ref(false)
const formVisible = ref(false)
const txFormVisible = ref(false)
const txFormType = ref<'deposit' | 'opening_balance'>('deposit')
const txLimit = 20
const txOffset = ref(0)

const qForm = reactive({ currency: 'USD', amount: '', date: new Date().toISOString().slice(0, 16) })
const qFormError = ref('')
const qFormSaving = ref(false)

const accountPositions = computed(() => {
  if (!positionsData.value) return []
  return positionsData.value.positions.filter((p) => p.accountId === accountId.value)
})

const cashBalances = computed(() => {
  if (!positionsData.value) return []
  return positionsData.value.cash.filter((c) => c.accountId === accountId.value)
})

onMounted(async () => {
  await loadAll()
})

async function loadAll() {
  loadingAccount.value = true
  accountError.value = ''
  try {
    account.value = await getAccount(accountId.value)
  } catch (e: any) {
    accountError.value = e?.message ?? t('common.error')
  } finally {
    loadingAccount.value = false
  }

  loadingPositions.value = true
  try {
    await fetchPositions({ accountId: accountId.value })
  } finally {
    loadingPositions.value = false
  }

  await loadTx()
}

async function loadTx() {
  await listTx({ accountId: accountId.value, limit: txLimit, offset: txOffset.value })
}

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

function txTypeLabel(type: string): string {
  const key = `transactions.type${type.charAt(0).toUpperCase() + type.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`
  return t(key, type)
}

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

async function prevPage() {
  txOffset.value = Math.max(0, txOffset.value - txLimit)
  await loadTx()
}

async function nextPage() {
  txOffset.value += txLimit
  await loadTx()
}

function openEdit() {
  formVisible.value = true
}

async function onFormSaved(saved: AccountWithBalances) {
  formVisible.value = false
  account.value = saved
}

function openTxForm(type: 'deposit' | 'opening_balance') {
  txFormType.value = type
  qForm.currency = 'USD'
  qForm.amount = ''
  qForm.date = new Date().toISOString().slice(0, 16)
  qFormError.value = ''
  txFormVisible.value = true
}

async function submitQuickTx() {
  qFormSaving.value = true
  qFormError.value = ''
  try {
    const ccy = qForm.currency.toUpperCase()
    const amountMinor = displayToMinor(qForm.amount, ccy)
    const type = txFormType.value
    const body: Record<string, unknown> = {
      accountId: accountId.value,
      type,
      currency: ccy,
      executedAt: new Date(qForm.date).toISOString(),
    }
    if (type === 'deposit' || type === 'opening_balance') {
      body.amountMinor = amountMinor
    }
    await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(body) })
    txFormVisible.value = false
    await loadAll()
  } catch (e: any) {
    qFormError.value = e?.message ?? t('errors.UNKNOWN')
  } finally {
    qFormSaving.value = false
  }
}
</script>

<style scoped>
.account-detail-page {
  max-width: 960px;
  margin: 0 auto;
}

.page-back {
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.page-back a {
  color: #2563eb;
  text-decoration: none;
  opacity: 0.8;
}

.page-back a:hover {
  opacity: 1;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.detail-header h1 {
  margin: 0;
  font-size: 1.4rem;
}

.acc-kind {
  font-size: 0.8rem;
  opacity: 0.55;
  margin-top: 2px;
}

.acc-note {
  font-size: 0.85rem;
  opacity: 0.6;
  margin-top: 4px;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.quick-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.btn-action {
  padding: 0.45rem 1rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-action-outline {
  padding: 0.45rem 1rem;
  background: transparent;
  border: 1px solid #2563eb;
  color: #2563eb;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border, #eee);
}

.cash-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.cash-card {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  padding: 0.625rem 1rem;
  min-width: 120px;
  background: var(--color-surface, #fff);
}

.cash-neg {
  border-color: #fca5a5;
  background: #fff5f5;
}

.cash-ccy {
  font-size: 0.75rem;
  opacity: 0.55;
  text-transform: uppercase;
}

.cash-amount {
  font-size: 1.05rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text, inherit);
}

.cash-neg .cash-amount {
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
  flex-shrink: 0;
}

/* TX journal */
.tx-list {
  display: flex;
  flex-direction: column;
  gap: 0px;
}

.tx-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.5rem 0.25rem;
  border-bottom: 1px solid var(--color-border, #f0f0f0);
  font-size: 0.9rem;
}

.tx-row:last-child {
  border-bottom: none;
}

.tx-main {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  flex-wrap: wrap;
  min-width: 0;
}

.tx-type {
  font-weight: 500;
  background: #f1f5f9;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 0.78rem;
  white-space: nowrap;
}

.tx-asset {
  font-weight: 600;
}

.tx-date {
  font-size: 0.8rem;
  opacity: 0.5;
  white-space: nowrap;
}

.tx-right {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  flex-shrink: 0;
}

.tx-amount {
  font-weight: 600;
}

.tx-qty {
  font-size: 0.8rem;
  opacity: 0.5;
}

.tx-pagination {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  justify-content: center;
}

.btn-page {
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: inherit;
}

.btn-page:disabled {
  opacity: 0.3;
  cursor: default;
}

.page-info {
  font-size: 0.85rem;
  opacity: 0.65;
}

.empty-section {
  padding: 1.5rem 0;
  text-align: center;
  opacity: 0.4;
  font-size: 0.9rem;
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

.loading-sm {
  padding: 1rem 0;
  text-align: center;
  opacity: 0.55;
  font-size: 0.85rem;
}

/* Quick TX modal */
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

.tx-quick-form {
  background: var(--color-surface, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.tx-quick-form h3 {
  margin: 0 0 1rem;
  font-size: 1rem;
}

.field {
  margin-bottom: 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field label {
  font-size: 0.82rem;
  opacity: 0.65;
  font-weight: 500;
}

.field input {
  padding: 0.45rem 0.625rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 5px;
  font-size: 0.95rem;
  background: var(--color-input, #fff);
  color: inherit;
}

.form-error {
  color: #c0392b;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

.btn-primary {
  padding: 0.45rem 1.1rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
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

/* Responsive */
@media (max-width: 480px) {
  .detail-header {
    flex-direction: column;
  }

  .cash-grid {
    flex-direction: column;
  }

  .cash-card {
    min-width: unset;
  }

  .tx-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .tx-right {
    align-self: flex-end;
  }
}
</style>
