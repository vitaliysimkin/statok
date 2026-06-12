<template>
  <div class="tx-page">
    <header class="tx-header">
      <h1>{{ t('transactions.title') }}</h1>
      <div class="tx-header-actions">
        <button type="button" class="btn primary" @click="openCreate">{{ t('transactions.newTransaction') }}</button>
        <button type="button" class="btn ghost" @click="openTransfer">{{ t('transfer.title') }}</button>
      </div>
    </header>

    <!-- Filters -->
    <section class="filters">
      <div class="filter">
        <label for="f-account">{{ t('transactions.filterByAccount') }}</label>
        <select id="f-account" v-model="filterAccount" @change="reload">
          <option value="">{{ t('common.all') }}</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
      <div class="filter">
        <label for="f-asset">{{ t('transactions.filterByAsset') }}</label>
        <select id="f-asset" v-model="filterAsset" @change="reload">
          <option value="">{{ t('common.all') }}</option>
          <option v-for="a in assets" :key="a.id" :value="a.id">{{ a.symbol }}</option>
        </select>
      </div>
      <div class="filter">
        <label for="f-type">{{ t('transactions.filterByType') }}</label>
        <select id="f-type" v-model="filterType" @change="reload">
          <option value="">{{ t('common.all') }}</option>
          <option v-for="tt in allTypes" :key="tt" :value="tt">{{ typeLabel(tt) }}</option>
        </select>
      </div>
      <div class="filter">
        <label for="f-from">{{ t('common.from') }}</label>
        <input id="f-from" v-model="filterFrom" type="date" @change="reload" />
      </div>
      <div class="filter">
        <label for="f-to">{{ t('common.to') }}</label>
        <input id="f-to" v-model="filterTo" type="date" @change="reload" />
      </div>
      <button type="button" class="btn ghost clear" @click="clearFilters">{{ t('transactions.clearFilters') }}</button>
    </section>

    <p v-if="loading" class="status">{{ t('common.loading') }}</p>
    <p v-else-if="error" class="status err">{{ error }}</p>

    <TransactionsTable v-else :items="items" @edit="openEdit" @delete="confirmDelete" />

    <!-- Pagination -->
    <footer v-if="total > pageSize" class="pager">
      <TButton
        mode="ghost"
        icon="system-uicons:chevron-left"
        :disabled="page === 0"
        :aria-label="t('common.prevPage')"
        @click="prevPage"
      />
      <span aria-live="polite">{{ t('transactions.page') }} {{ page + 1 }} {{ t('transactions.of') }} {{ totalPages }}</span>
      <TButton
        mode="ghost"
        icon="system-uicons:chevron-right"
        :disabled="page + 1 >= totalPages"
        :aria-label="t('common.nextPage')"
        @click="nextPage"
      />
    </footer>

    <!-- Modal: transaction form -->
    <div v-if="showForm" class="modal-backdrop" role="dialog" aria-modal="true" :aria-label="editing ? t('transactionForm.editTitle') : t('transactionForm.title')" @click.self="closeForm" @keydown.esc="closeForm">
      <div class="modal">
        <TransactionForm
          :accounts="accounts"
          :assets="assets"
          :edit="editing"
          @cancel="closeForm"
          @saved="onSaved"
        />
      </div>
    </div>

    <!-- Modal: transfer form (create or edit both legs) -->
    <div v-if="showTransfer" class="modal-backdrop" role="dialog" aria-modal="true" :aria-label="editingTransfer ? t('transactions.editTransfer') : t('transfer.title')" @click.self="closeForm" @keydown.esc="closeForm">
      <div class="modal">
        <TransferForm :accounts="accounts" :edit="editingTransfer" @cancel="closeForm" @saved="onSaved" />
      </div>
    </div>

    <!-- Delete confirmation -->
    <div v-if="deleteTarget" class="modal-backdrop" role="dialog" aria-modal="true" :aria-label="t('transactions.deleteConfirm')" @click.self="deleteTarget = null" @keydown.esc="deleteTarget = null">
      <div ref="deleteDialogRef" class="modal confirm" tabindex="-1">
        <p>{{ deleteTarget.transferGroupId ? t('transactions.deleteTransferConfirm') : t('transactions.deleteConfirm') }}</p>
        <p v-if="deleteError" class="status err">{{ deleteError }}</p>
        <div class="confirm-actions">
          <TButton mode="ghost" :label="t('common.cancel')" @click="deleteTarget = null" />
          <TButton
            variant="danger"
            :label="deleting ? t('common.loading') : t('common.delete')"
            :disabled="deleting"
            @click="doDelete"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButton } from '@vitaliysimkin/t-components'
import { TRANSACTION_TYPES } from '@statok/shared'
import type { Transaction, TransactionListItem } from '@statok/shared'
import { useTransactions } from '@/composables/useTransactions'
import { useAccounts } from '@/composables/useAccounts'
import { useAssets } from '@/composables/useAssets'
import { ApiError, errKey } from '@/services/api'
import TransactionsTable from '@/components/transactions/TransactionsTable.vue'
import TransactionForm from '@/components/transactions/TransactionForm.vue'
import TransferForm, { type TransferEdit } from '@/components/transactions/TransferForm.vue'

const { t } = useI18n()
const { items, total, loading, error, list, get, remove } = useTransactions()
// Separate instance for resolving a transfer's sibling leg without disturbing the main list.
const { list: lookupList, items: lookupItems } = useTransactions()
const { accounts, list: listAccounts } = useAccounts()
const { assets, list: listAssets } = useAssets()

const allTypes = TRANSACTION_TYPES
const TYPE_KEY: Record<string, string> = {
  buy: 'transactions.typeBuy',
  sell: 'transactions.typeSell',
  deposit: 'transactions.typeDeposit',
  withdraw: 'transactions.typeWithdraw',
  dividend: 'transactions.typeDividend',
  coupon: 'transactions.typeCoupon',
  interest: 'transactions.typeInterest',
  split: 'transactions.typeSplit',
  transfer_in: 'transactions.typeTransferIn',
  transfer_out: 'transactions.typeTransferOut',
  ticker_change: 'transactions.typeTickerChange',
  opening_balance: 'transactions.typeOpeningBalance',
}
function typeLabel(tt: string): string {
  return TYPE_KEY[tt] ? t(TYPE_KEY[tt]) : tt
}

// ── filters & pagination ───────────────────────────────────────────────────────
const filterAccount = ref('')
const filterAsset = ref('')
const filterType = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const page = ref(0)
const pageSize = 50

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function buildFilters() {
  return {
    accountId: filterAccount.value || undefined,
    assetId: filterAsset.value || undefined,
    type: filterType.value || undefined,
    from: filterFrom.value || undefined,
    to: filterTo.value || undefined,
    limit: pageSize,
    offset: page.value * pageSize,
  }
}

async function load() {
  await list(buildFilters())
}

function reload() {
  page.value = 0
  void load()
}

function clearFilters() {
  filterAccount.value = ''
  filterAsset.value = ''
  filterType.value = ''
  filterFrom.value = ''
  filterTo.value = ''
  reload()
}

function nextPage() {
  if (page.value + 1 < totalPages.value) {
    page.value++
    void load()
  }
}
function prevPage() {
  if (page.value > 0) {
    page.value--
    void load()
  }
}

// ── modals ───────────────────────────────────────────────────────────────────
const showForm = ref(false)
const showTransfer = ref(false)
const editing = ref<Transaction | null>(null)
const editingTransfer = ref<TransferEdit | null>(null)

function openCreate() {
  editing.value = null
  editingTransfer.value = null
  showTransfer.value = false
  showForm.value = true
}
function openTransfer() {
  editing.value = null
  editingTransfer.value = null
  showForm.value = false
  showTransfer.value = true
}
async function openEdit(row: TransactionListItem) {
  try {
    // Transfer legs open the dedicated transfer form (both legs) — never the generic form.
    if (row.transferGroupId) {
      editingTransfer.value = await resolveTransferEdit(row)
      editing.value = null
      showForm.value = false
      showTransfer.value = true
      return
    }
    editing.value = await get(row.id)
    editingTransfer.value = null
    showTransfer.value = false
    showForm.value = true
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('errors.UNKNOWN')
  }
}

/** Load both legs of a transfer and orient them as out/in for the edit form. */
async function resolveTransferEdit(row: TransactionListItem): Promise<TransferEdit> {
  const clicked = await get(row.id)
  // Both legs share executedAt + transferGroupId; fetch the instant and pick the sibling.
  await lookupList({ from: clicked.executedAt, to: clicked.executedAt, limit: 500 })
  const sibling = lookupItems.value.find(
    (r) => r.transferGroupId === clicked.transferGroupId && r.id !== clicked.id,
  )
  if (!sibling) throw new ApiError(404, 'NOT_FOUND', 'Transfer pair not found')
  const other = await get(sibling.id)
  const out = clicked.type === 'transfer_out' ? clicked : other
  const inLeg = clicked.type === 'transfer_in' ? clicked : other
  return { out, in: inLeg }
}

function closeForm() {
  showForm.value = false
  showTransfer.value = false
  editing.value = null
  editingTransfer.value = null
}
function onSaved() {
  closeForm()
  void load()
}

// ── delete ───────────────────────────────────────────────────────────────────
const deleteTarget = ref<TransactionListItem | null>(null)
const deleting = ref(false)
const deleteError = ref('')
const deleteDialogRef = ref<HTMLElement | null>(null)

function confirmDelete(row: TransactionListItem) {
  deleteError.value = ''
  deleteTarget.value = row
}

// Autofocus the confirm dialog so Esc works and the action is reachable from the keyboard.
watch(deleteTarget, async (v) => {
  if (!v) return
  await nextTick()
  deleteDialogRef.value?.focus()
})
async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await remove(deleteTarget.value.id)
    deleteTarget.value = null
    void load()
  } catch (e) {
    deleteError.value = e instanceof ApiError ? t(errKey(e)) : t('errors.UNKNOWN')
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await Promise.all([listAccounts(false), listAssets()])
  await load()
})
</script>

<style scoped>
.tx-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.tx-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}
.tx-header h1 {
  margin: 0;
  font-size: 1.5rem;
}
.tx-header-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: flex-end;
}
.filter {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.filter label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--color-text-muted, #666);
}
.filter select,
.filter input {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  font-size: 0.9rem;
  background: var(--color-input-bg, #fff);
  color: var(--color-text, #000);
}
.clear {
  align-self: flex-end;
}
.status {
  color: var(--color-text-muted, #666);
}
.status.err {
  color: var(--color-error, #dc2626);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  font-size: 0.9rem;
}
.btn {
  padding: 0.45rem 0.9rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn.primary {
  background: var(--color-accent, #2563eb);
  color: #fff;
}
.btn.ghost {
  background: transparent;
  border-color: var(--color-border, #ccc);
  color: var(--color-text, #000);
}
.btn.danger {
  background: var(--color-error, #dc2626);
  color: #fff;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 1.5rem 1rem;
  overflow-y: auto;
  z-index: 50;
}
.modal {
  width: 100%;
  max-width: 480px;
  background: var(--color-surface, #fff);
  color: var(--color-text, #000);
  border-radius: 10px;
  padding: 1.25rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}
.modal.confirm {
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}
@media (max-width: 360px) {
  .filter,
  .filter select,
  .filter input {
    width: 100%;
  }
  .filters {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
