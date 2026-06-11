<template>
  <form class="tx-form" @submit.prevent="handleSubmit">
    <h2 class="form-title">{{ isEdit ? t('transactionForm.editTitle') : t('transactionForm.title') }}</h2>

    <!-- Type: locked on edit (type is immutable per spec §4) -->
    <div class="field">
      <label for="tx-type">{{ t('transactions.type') }}</label>
      <select id="tx-type" v-model="type" :disabled="isEdit" required>
        <option v-for="tt in selectableTypes" :key="tt" :value="tt">{{ typeLabel(tt) }}</option>
      </select>
    </div>

    <!-- opening_balance sub-mode: asset position vs cash balance -->
    <div v-if="type === 'opening_balance'" class="field">
      <label>{{ t('transactions.typeOpeningBalance') }}</label>
      <div class="seg">
        <label class="seg-opt">
          <input v-model="obMode" type="radio" value="asset" />
          {{ t('transactions.asset') }}
        </label>
        <label class="seg-opt">
          <input v-model="obMode" type="radio" value="cash" />
          {{ t('accountDetail.cashBalances') }}
        </label>
      </div>
      <small class="hint">{{ t('transactionForm.openingBalanceHint') }}</small>
    </div>

    <div class="field">
      <label for="tx-date">{{ t('transactions.date') }}</label>
      <input id="tx-date" v-model="dateInput" type="datetime-local" required />
    </div>

    <div class="field">
      <label for="tx-account">{{ t('transactions.account') }}</label>
      <select id="tx-account" v-model="accountId" required>
        <option value="" disabled>{{ t('transactionForm.selectAccount') }}</option>
        <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </div>

    <!-- Asset picker: required for asset-bound types; filtered by type compatibility -->
    <div v-if="show.asset" class="field">
      <label for="tx-asset">{{ t('transactions.asset') }}</label>
      <select id="tx-asset" v-model="assetId" required>
        <option value="" disabled>{{ t('transactionForm.selectAsset') }}</option>
        <option v-for="a in eligibleAssets" :key="a.id" :value="a.id">
          {{ a.symbol }} — {{ a.name }} ({{ a.currency }})
        </option>
      </select>
    </div>

    <div v-if="show.quantity" class="field">
      <label for="tx-qty">{{ type === 'split' ? t('transactions.splitMultiplier') : t('transactions.quantity') }}</label>
      <input id="tx-qty" v-model="quantity" type="text" inputmode="decimal" required />
    </div>

    <div v-if="show.price" class="field">
      <label for="tx-price">
        {{ t('transactions.price') }}
        <span v-if="type === 'opening_balance'" class="muted">({{ t('common.optional') }})</span>
      </label>
      <input id="tx-price" v-model="price" type="text" inputmode="decimal" :required="show.priceRequired" />
    </div>

    <div v-if="show.amount" class="field">
      <label for="tx-amount">{{ t('transactions.amount') }}</label>
      <input id="tx-amount" v-model="amount" type="text" inputmode="decimal" :required="show.amountRequired" />
      <small v-if="type === 'buy' || type === 'sell'" class="hint">{{ t('transactionForm.amountHint') }}</small>
    </div>

    <div v-if="show.fee" class="field">
      <label for="tx-fee">{{ t('transactions.fee') }} <span class="muted">({{ t('common.optional') }})</span></label>
      <input id="tx-fee" v-model="fee" type="text" inputmode="decimal" />
      <small class="hint">{{ t('transactionForm.feeHint') }}</small>
    </div>

    <!-- Income block: dividend / coupon / interest -->
    <template v-if="show.income">
      <div class="field">
        <label for="tx-gross">{{ t('transactions.gross') }}</label>
        <input id="tx-gross" v-model="gross" type="text" inputmode="decimal" required />
        <small class="hint">{{ t('transactionForm.grossHint') }}</small>
      </div>
      <div class="field">
        <label for="tx-wht">{{ t('transactions.withholdingTax') }} <span class="muted">({{ t('common.optional') }})</span></label>
        <input id="tx-wht" v-model="wht" type="text" inputmode="decimal" />
        <small class="hint">{{ t('transactionForm.whtHint') }}</small>
      </div>
      <p class="net-preview">{{ t('transactions.net') }}: <strong>{{ netPreview }}</strong></p>
      <small class="hint">{{ t('transactionForm.netComputed') }}</small>
    </template>

    <!-- Currency: explicit only for pure-cash types; asset types derive it from the asset -->
    <div v-if="show.currency" class="field">
      <label for="tx-ccy">{{ t('transactions.currency') }}</label>
      <input id="tx-ccy" v-model="currency" type="text" maxlength="3" required class="ccy" />
    </div>

    <div class="field">
      <label for="tx-note">{{ t('transactions.note') }} <span class="muted">({{ t('common.optional') }})</span></label>
      <input id="tx-note" v-model="note" type="text" />
    </div>

    <p v-if="localError" class="form-error" role="alert">{{ localError }}</p>
    <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

    <div class="form-actions">
      <button type="button" class="btn ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button type="submit" class="btn primary" :disabled="submitting">
        {{ submitting ? t('common.loading') : t('common.save') }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayToMinor, formatMoney } from '@statok/shared'
import type {
  AccountWithBalances,
  Asset,
  CreateTransactionRequest,
  Transaction,
  TransactionType,
} from '@statok/shared'
import { useTransactions } from '@/composables/useTransactions'
import { ApiError } from '@/services/api'

const props = defineProps<{
  accounts: AccountWithBalances[]
  assets: Asset[]
  /** When set, the form edits an existing transaction (type locked). */
  edit?: Transaction | null
}>()
const emit = defineEmits<{ cancel: []; saved: [] }>()

const { t } = useI18n()
const { create, update } = useTransactions()

// Types selectable in this form. transfer_in/out → TransferForm; ticker_change → assets page.
const selectableTypes: TransactionType[] = [
  'buy',
  'sell',
  'deposit',
  'withdraw',
  'dividend',
  'coupon',
  'interest',
  'split',
  'opening_balance',
]

const TYPE_KEY: Record<string, string> = {
  buy: 'transactions.typeBuy',
  sell: 'transactions.typeSell',
  deposit: 'transactions.typeDeposit',
  withdraw: 'transactions.typeWithdraw',
  dividend: 'transactions.typeDividend',
  coupon: 'transactions.typeCoupon',
  interest: 'transactions.typeInterest',
  split: 'transactions.typeSplit',
  opening_balance: 'transactions.typeOpeningBalance',
}
function typeLabel(tt: string): string {
  return TYPE_KEY[tt] ? t(TYPE_KEY[tt]) : tt
}

const isEdit = computed(() => !!props.edit)

// ── form state ───────────────────────────────────────────────────────────────
const type = ref<TransactionType>('buy')
const obMode = ref<'asset' | 'cash'>('asset')
const accountId = ref('')
const assetId = ref('')
const quantity = ref('')
const price = ref('')
const amount = ref('')
const fee = ref('')
const gross = ref('')
const wht = ref('')
const currency = ref('')
const note = ref('')
const dateInput = ref(nowLocal())

const localError = ref('')
const serverError = ref('')
const submitting = ref(false)

function nowLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

// Asset-type compatibility per matrix: dividend↔stock/etf, coupon↔bond, interest=cash (resolved by ccy).
const eligibleAssets = computed<Asset[]>(() => {
  const nonCash = props.assets.filter((a) => a.type !== 'cash')
  if (type.value === 'dividend') return nonCash.filter((a) => a.type === 'stock' || a.type === 'etf')
  if (type.value === 'coupon') return nonCash.filter((a) => a.type === 'bond')
  return nonCash
})

const selectedAsset = computed<Asset | undefined>(() =>
  props.assets.find((a) => a.id === assetId.value),
)

// ── field-visibility matrix (ТЗ §7.1.6) ────────────────────────────────────────
const show = computed(() => {
  const tp = type.value
  const isTrade = tp === 'buy' || tp === 'sell'
  const isCashMove = tp === 'deposit' || tp === 'withdraw'
  const isIncome = tp === 'dividend' || tp === 'coupon' || tp === 'interest'
  const isSplit = tp === 'split'
  const isOpening = tp === 'opening_balance'
  const openingAsset = isOpening && obMode.value === 'asset'
  const openingCash = isOpening && obMode.value === 'cash'

  // asset_id points to a real (non-cash) asset for: trade, dividend, coupon, split, opening(asset).
  const assetBound = isTrade || tp === 'dividend' || tp === 'coupon' || isSplit || openingAsset

  return {
    asset: assetBound,
    quantity: isTrade || isSplit || openingAsset,
    price: isTrade || openingAsset,
    priceRequired: isTrade,
    amount: isTrade || isCashMove || openingCash,
    amountRequired: isTrade || isCashMove || openingCash,
    fee: isTrade,
    income: isIncome,
    // Currency entered explicitly only when there's no asset to derive it from.
    currency: isCashMove || tp === 'interest' || openingCash,
  }
})

// Trade currency follows the chosen asset; keep the field in sync (read-only derive).
watch([selectedAsset, type], () => {
  if (show.value.asset && selectedAsset.value) currency.value = selectedAsset.value.currency
})

const netPreview = computed(() => {
  const ccy = currency.value || selectedAsset.value?.currency || 'USD'
  try {
    const g = gross.value ? displayToMinor(gross.value, ccy) : 0
    const w = wht.value ? displayToMinor(wht.value, ccy) : 0
    return formatMoney(g - w, ccy, undefined)
  } catch {
    return '—'
  }
})

// ── edit hydration ─────────────────────────────────────────────────────────────
watch(
  () => props.edit,
  (tx) => {
    if (!tx) return
    type.value = tx.type
    accountId.value = tx.accountId
    assetId.value = tx.assetId
    quantity.value = tx.quantity ?? ''
    price.value = tx.price ?? ''
    currency.value = tx.currency
    note.value = tx.note ?? ''
    const d = new Date(tx.executedAt)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    dateInput.value = d.toISOString().slice(0, 16)
    amount.value = tx.amountMinor != null ? minorToInput(tx.amountMinor) : ''
    fee.value = tx.feeMinor ? minorToInput(tx.feeMinor) : ''
    gross.value = tx.grossMinor != null ? minorToInput(tx.grossMinor) : ''
    wht.value = tx.withholdingTaxMinor != null ? minorToInput(tx.withholdingTaxMinor) : ''
    if (tx.type === 'opening_balance') obMode.value = tx.amountMinor != null && !tx.quantity ? 'cash' : 'asset'
  },
  { immediate: true },
)

function minorToInput(minor: number): string {
  // Plain decimal string with 2 digits — v1 currencies (UAH/USD/EUR) are all 2-minor.
  return (minor / 100).toFixed(2)
}

function errKey(code: string): string {
  const translated = t(`errors.${code}`)
  return translated !== `errors.${code}` ? translated : t('errors.UNKNOWN')
}

function parseMinorOrThrow(v: string, ccy: string): number {
  return displayToMinor(v, ccy)
}

async function handleSubmit() {
  localError.value = ''
  serverError.value = ''

  const ccy = (show.value.currency ? currency.value : selectedAsset.value?.currency || currency.value)
    .toUpperCase()

  // Client-side validation per matrix.
  if (show.value.asset && !assetId.value) {
    localError.value = t('errors.VALIDATION_ERROR')
    return
  }

  const body: CreateTransactionRequest = {
    accountId: accountId.value,
    type: type.value,
    executedAt: new Date(dateInput.value).toISOString(),
    currency: ccy,
  }
  if (show.value.asset) body.assetId = assetId.value

  try {
    if (show.value.quantity) {
      if (!quantity.value) throw new Error('qty')
      body.quantity = quantity.value.trim()
    }
    if (show.value.price && price.value) body.price = price.value.trim()
    if (show.value.amount) {
      if (show.value.amountRequired && !amount.value) throw new Error('amount')
      if (amount.value) body.amountMinor = parseMinorOrThrow(amount.value, ccy)
    }
    if (show.value.fee && fee.value) body.feeMinor = parseMinorOrThrow(fee.value, ccy)
    if (show.value.income) {
      if (!gross.value) throw new Error('gross')
      body.grossMinor = parseMinorOrThrow(gross.value, ccy)
      body.withholdingTaxMinor = wht.value ? parseMinorOrThrow(wht.value, ccy) : 0
    }
  } catch {
    localError.value = t('errors.VALIDATION_ERROR')
    return
  }

  if (note.value) body.note = note.value

  submitting.value = true
  try {
    if (props.edit) {
      await update(props.edit.id, body)
    } else {
      await create(body)
    }
    emit('saved')
  } catch (e) {
    serverError.value = e instanceof ApiError ? errKey(e.code) : t('errors.UNKNOWN')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.tx-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.form-title {
  margin: 0;
  font-size: 1.15rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.field label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted, #555);
}
.muted {
  color: var(--color-text-muted, #999);
  font-weight: 400;
}
.hint {
  font-size: 0.75rem;
  color: var(--color-text-muted, #888);
}
.ccy {
  text-transform: uppercase;
  max-width: 7rem;
}
.seg {
  display: flex;
  gap: 1rem;
}
.seg-opt {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.9rem;
  color: var(--color-text, #000);
}
.net-preview {
  margin: 0.2rem 0 0;
  font-size: 0.95rem;
}
input,
select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  font-size: 0.95rem;
  background: var(--color-input-bg, #fff);
  color: var(--color-text, #000);
}
input[type='radio'] {
  padding: 0;
  width: auto;
}
input:focus,
select:focus {
  outline: 2px solid var(--color-accent, #2563eb);
  outline-offset: 1px;
}
.form-error {
  margin: 0;
  color: var(--color-error, #dc2626);
  font-size: 0.85rem;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.25rem;
}
.btn {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn.primary {
  background: var(--color-accent, #2563eb);
  color: #fff;
}
.btn.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn.ghost {
  background: transparent;
  border-color: var(--color-border, #ccc);
  color: var(--color-text, #000);
}
</style>
