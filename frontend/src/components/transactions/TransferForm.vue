<template>
  <form class="tx-form" @submit.prevent="handleSubmit">
    <h2 class="form-title">{{ isEdit ? t('transactions.editTransfer') : t('transfer.title') }}</h2>

    <div class="field">
      <label for="tr-date">{{ t('transfer.date') }}</label>
      <TDateTimeInput id="tr-date" v-model="dateInput" />
    </div>

    <fieldset class="leg">
      <legend>{{ t('transfer.fromAccount') }}</legend>
      <div class="field">
        <label for="tr-from-acc">{{ t('transfer.fromAccount') }}</label>
        <TSelect
          id="tr-from-acc"
          v-model="fromAccountId"
          value-mode="value"
          :options="accountOptions"
          :disabled="isEdit"
          :placeholder="t('transactionForm.selectAccount')"
        />
      </div>
      <div class="row">
        <div class="field grow">
          <label for="tr-out-amt">{{ t('transfer.fromAmount') }}</label>
          <TInput id="tr-out-amt" ref="firstFieldRef" v-model="outAmount" inputmode="decimal" />
        </div>
        <div class="field">
          <label for="tr-out-ccy">{{ t('transfer.fromCurrency') }}</label>
          <TInput id="tr-out-ccy" v-model="outCurrency" maxlength="3" class="ccy" />
        </div>
      </div>
    </fieldset>

    <fieldset class="leg">
      <legend>{{ t('transfer.toAccount') }}</legend>
      <div class="field">
        <label for="tr-to-acc">{{ t('transfer.toAccount') }}</label>
        <TSelect
          id="tr-to-acc"
          v-model="toAccountId"
          value-mode="value"
          :options="accountOptions"
          :disabled="isEdit"
          :placeholder="t('transactionForm.selectAccount')"
        />
      </div>
      <div class="row">
        <div class="field grow">
          <label for="tr-in-amt">{{ t('transfer.toAmount') }}</label>
          <TInput id="tr-in-amt" v-model="inAmount" inputmode="decimal" />
        </div>
        <div class="field">
          <label for="tr-in-ccy">{{ t('transfer.toCurrency') }}</label>
          <TInput id="tr-in-ccy" v-model="inCurrency" maxlength="3" class="ccy" />
        </div>
      </div>
    </fieldset>

    <div class="field">
      <label for="tr-note">{{ t('transactions.note') }} ({{ t('common.optional') }})</label>
      <TInput id="tr-note" v-model="note" />
    </div>

    <p v-if="localError" class="form-error" role="alert">{{ localError }}</p>
    <p v-if="serverError" class="form-error" role="alert">{{ serverError }}</p>

    <div class="form-actions">
      <TButton type="button" mode="ghost" :label="t('common.cancel')" @click="emit('cancel')" />
      <TButton
        type="submit"
        variant="accent"
        :label="submitting ? t('common.loading') : t('common.save')"
        :disabled="submitting"
      />
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButton, TDateTimeInput, TInput, TSelect } from '@vitaliysimkin/t-components'
import { displayToMinor } from '@statok/shared'
import type {
  AccountWithBalances,
  CreateTransferRequest,
  Transaction,
} from '@statok/shared'
import { useTransactions } from '@/composables/useTransactions'
import { ApiError, errKey } from '@/services/api'

/** A pair of legs to edit, resolved by the page (out/in by leg type). */
export interface TransferEdit {
  out: Transaction
  in: Transaction
}

const props = defineProps<{
  accounts: AccountWithBalances[]
  edit?: TransferEdit | null
}>()
const emit = defineEmits<{ cancel: []; saved: [] }>()

const { t } = useI18n()
const { createTransfer, update } = useTransactions()

const isEdit = computed(() => !!props.edit)

const accountOptions = computed(() =>
  props.accounts.map((a) => ({ value: a.id, label: a.name })),
)

function nowLocal(): string {
  return new Date().toISOString()
}

const dateInput = ref(nowLocal())
const fromAccountId = ref('')
const toAccountId = ref('')
const outAmount = ref('')
const outCurrency = ref('')
const inAmount = ref('')
const inCurrency = ref('')
const note = ref('')

const localError = ref('')
const serverError = ref('')
const submitting = ref(false)

const firstFieldRef = ref<{ inputRef?: HTMLInputElement } | null>(null)

// minor → plain decimal string (v1 currencies are all 2-minor).
function minorToInput(minor: number | null): string {
  return minor != null ? (minor / 100).toFixed(2) : ''
}

function hydrate(e: TransferEdit): void {
  dateInput.value = e.out.executedAt
  fromAccountId.value = e.out.accountId
  toAccountId.value = e.in.accountId
  outAmount.value = minorToInput(e.out.amountMinor)
  outCurrency.value = e.out.currency
  inAmount.value = minorToInput(e.in.amountMinor)
  inCurrency.value = e.in.currency
  note.value = e.out.note ?? ''
}

if (props.edit) hydrate(props.edit)

onMounted(async () => {
  await nextTick()
  firstFieldRef.value?.inputRef?.focus()
})

async function handleSubmit() {
  localError.value = ''
  serverError.value = ''

  if (!isEdit.value) {
    if (!fromAccountId.value || !toAccountId.value) {
      localError.value = t('errors.VALIDATION_ERROR')
      return
    }
    if (fromAccountId.value === toAccountId.value) {
      localError.value = t('transfer.sameAccountError')
      return
    }
  }
  let outMinor: number
  let inMinor: number
  try {
    outMinor = displayToMinor(outAmount.value, outCurrency.value)
    inMinor = displayToMinor(inAmount.value, inCurrency.value)
  } catch {
    localError.value = t('errors.VALIDATION_ERROR')
    return
  }
  if (outMinor <= 0 || inMinor <= 0) {
    localError.value = t('errors.VALIDATION_ERROR')
    return
  }

  submitting.value = true
  try {
    if (props.edit) {
      const executedAt = new Date(dateInput.value).toISOString()
      // PUT each leg with its own amount/currency; the backend syncs executedAt/note to the pair.
      await update(props.edit.out.id, {
        executedAt,
        note: note.value,
        amountMinor: outMinor,
        currency: outCurrency.value.toUpperCase(),
      })
      await update(props.edit.in.id, {
        executedAt,
        note: note.value,
        amountMinor: inMinor,
        currency: inCurrency.value.toUpperCase(),
      })
    } else {
      const payload: CreateTransferRequest = {
        fromAccountId: fromAccountId.value,
        toAccountId: toAccountId.value,
        executedAt: new Date(dateInput.value).toISOString(),
        outAmountMinor: outMinor,
        outCurrency: outCurrency.value.toUpperCase(),
        inAmountMinor: inMinor,
        inCurrency: inCurrency.value.toUpperCase(),
        note: note.value || undefined,
      }
      await createTransfer(payload)
    }
    emit('saved')
  } catch (e) {
    serverError.value = e instanceof ApiError ? t(errKey(e)) : t('errors.UNKNOWN')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.tx-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.form-title {
  margin: 0;
  font-size: 1.15rem;
}
.leg {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
}
.leg legend {
  font-weight: 600;
  padding: 0 0.4rem;
  font-size: 0.9rem;
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
.row {
  display: flex;
  gap: 0.6rem;
}
.grow {
  flex: 1;
}
.ccy {
  width: 5rem;
  text-transform: uppercase;
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
}
@media (max-width: 480px) {
  .row {
    flex-direction: column;
  }
  .ccy {
    width: 100%;
  }
}
</style>
