<template>
  <div class="accounts-page">
    <div class="page-header">
      <h1>{{ t('accounts.title') }}</h1>
      <TButton
        :label="t('accounts.newAccount')"
        variant="accent"
        icon="system-uicons:plus"
        @click="openCreate"
      />
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
                <span v-if="b.cashMinor < 0" class="warn-badge" :title="t('accounts.negativeCashWarning')">!</span>
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
              <TButton
                icon="system-uicons:pen"
                mode="ghost"
                size="mini"
                :aria-label="t('common.edit')"
                @click="openEdit(acc)"
              />
              <TButton
                icon="system-uicons:box"
                mode="ghost"
                size="mini"
                :aria-label="t('accounts.archiveAccount')"
                @click="doArchive(acc)"
              />
              <TButton
                icon="system-uicons:trash"
                mode="ghost"
                size="mini"
                variant="danger"
                :aria-label="t('accounts.deleteAccount')"
                @click="doDelete(acc)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Include archived toggle -->
      <div class="archived-toggle">
        <TSwitch
          v-model="includeArchived"
          size="small"
          :label="t('accounts.includeArchived')"
          @update:modelValue="reload"
        />
      </div>
    </template>

    <!-- Confirm dialog -->
    <div v-if="confirm.visible" class="confirm-overlay" role="dialog" aria-modal="true" :aria-label="confirm.message" @click.self="closeConfirm">
      <div class="confirm-dialog">
        <p id="confirm-msg">{{ confirm.message }}</p>
        <p v-if="confirm.errorKey" class="form-error" role="alert">{{ t(confirm.errorKey) }}</p>
        <div class="confirm-actions">
          <TButton ref="confirmCancelBtn" :label="t('common.cancel')" mode="ghost" @click="closeConfirm" />
          <TButton :label="t('common.confirm')" variant="danger" @click="confirm.onOk" />
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
import { ref, computed, onMounted, onBeforeUnmount, reactive, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { TButton, TSwitch } from '@vitaliysimkin/t-components'
import { formatMoney } from '@statok/shared'
import { useAccounts } from '@/composables/useAccounts'
import AccountForm from '@/components/accounts/AccountForm.vue'
import { apiFetch, errKey } from '@/services/api'
import { kindLabelKey } from '@/lib/accountKind'
import type { AccountWithBalances } from '@statok/shared'

const { t, locale } = useI18n()
const router = useRouter()
const { accounts, loading, error, archive } = useAccounts()

const includeArchived = ref(false)
const formVisible = ref(false)
const editingAccount = ref<AccountWithBalances | null>(null)
const baseCcy = ref('USD')
const confirmCancelBtn = ref<{ $el?: HTMLElement } | null>(null)

const confirm = reactive({
  visible: false,
  message: '',
  errorKey: '' as string,
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
  window.addEventListener('keydown', onKeydown)
  await reload()
  try {
    const s = await apiFetch<{ baseCurrency: string }>('/api/settings')
    baseCcy.value = s.baseCurrency
  } catch {}
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && confirm.visible) {
    e.stopPropagation()
    closeConfirm()
  }
}

watch(
  () => confirm.visible,
  async (open) => {
    if (open) {
      await nextTick()
      confirmCancelBtn.value?.$el?.focus?.()
    }
  },
)

const anyIncomplete = computed(() => accounts.value.some((a) => a.valuationIncomplete))

const totalNetWorth = computed(() => {
  const total = accounts.value.reduce((sum, a) => sum + (a.valueBaseMinor ?? 0), 0)
  return formatMoney(total, baseCcy.value, locale.value)
})

function kindLabel(kind: string): string {
  return t(kindLabelKey(kind))
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

function closeConfirm() {
  confirm.visible = false
  confirm.errorKey = ''
}

function doArchive(acc: AccountWithBalances) {
  confirm.message = t('accounts.archiveConfirm', { name: acc.name })
  confirm.errorKey = ''
  confirm.visible = true
  confirm.onOk = async () => {
    confirm.errorKey = ''
    try {
      await archive(acc.id)
      closeConfirm()
      await reload()
    } catch (e) {
      confirm.errorKey = errKey(e)
    }
  }
}

function doDelete(acc: AccountWithBalances) {
  confirm.message = t('accounts.deleteConfirm', { name: acc.name })
  confirm.errorKey = ''
  confirm.visible = true
  confirm.onOk = async () => {
    confirm.errorKey = ''
    try {
      await apiFetch(`/api/accounts/${acc.id}`, { method: 'DELETE' })
      closeConfirm()
      await reload()
    } catch (e) {
      confirm.errorKey = errKey(e)
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
  color: var(--color-warning-text, #92400e);
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
  border-color: var(--color-accent, #2563eb);
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
  color: var(--color-error, #dc2626);
}

.warn-badge {
  font-size: 0.7rem;
  background: var(--color-warning-bg, #fef3c7);
  color: var(--color-warning-text, #92400e);
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

.archived-toggle {
  margin-top: 1rem;
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
  color: var(--color-error, #dc2626);
  opacity: 1;
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

.form-error {
  color: var(--color-error, #c0392b);
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

/* Responsive 360px */
@media (max-width: 480px) {
  .account-card {
    flex-direction: column;
  }

  .card-right {
    align-items: center;
    width: 100%;
    flex-direction: row;
    flex-wrap: wrap;
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
