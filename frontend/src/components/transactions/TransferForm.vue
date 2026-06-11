<template>
  <form class="tx-form" @submit.prevent="handleSubmit">
    <h2 class="form-title">{{ t('transfer.title') }}</h2>

    <div class="field">
      <label for="tr-date">{{ t('transfer.date') }}</label>
      <input id="tr-date" v-model="dateInput" type="datetime-local" required />
    </div>

    <fieldset class="leg">
      <legend>{{ t('transfer.fromAccount') }}</legend>
      <div class="field">
        <label for="tr-from-acc">{{ t('transfer.fromAccount') }}</label>
        <select id="tr-from-acc" v-model="fromAccountId" required>
          <option value="" disabled>{{ t('transactionForm.selectAccount') }}</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
      <div class="row">
        <div class="field grow">
          <label for="tr-out-amt">{{ t('transfer.fromAmount') }}</label>
          <input id="tr-out-amt" v-model="outAmount" type="text" inputmode="decimal" required />
        </div>
        <div class="field">
          <label for="tr-out-ccy">{{ t('transfer.fromCurrency') }}</label>
          <input id="tr-out-ccy" v-model="outCurrency" type="text" maxlength="3" required class="ccy" />
        </div>
      </div>
    </fieldset>

    <fieldset class="leg">
      <legend>{{ t('transfer.toAccount') }}</legend>
      <div class="field">
        <label for="tr-to-acc">{{ t('transfer.toAccount') }}</label>
        <select id="tr-to-acc" v-model="toAccountId" required>
          <option value="" disabled>{{ t('transactionForm.selectAccount') }}</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
      <div class="row">
        <div class="field grow">
          <label for="tr-in-amt">{{ t('transfer.toAmount') }}</label>
          <input id="tr-in-amt" v-model="inAmount" type="text" inputmode="decimal" required />
        </div>
        <div class="field">
          <label for="tr-in-ccy">{{ t('transfer.toCurrency') }}</label>
          <input id="tr-in-ccy" v-model="inCurrency" type="text" maxlength="3" required class="ccy" />
        </div>
      </div>
    </fieldset>

    <div class="field">
      <label for="tr-note">{{ t('transactions.note') }} ({{ t('common.optional') }})</label>
      <input id="tr-note" v-model="note" type="text" />
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
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayToMinor } from '@statok/shared'
import type { AccountWithBalances, CreateTransferRequest } from '@statok/shared'
import { useTransactions } from '@/composables/useTransactions'
import { ApiError } from '@/services/api'

defineProps<{ accounts: AccountWithBalances[] }>()
const emit = defineEmits<{ cancel: []; saved: [] }>()

const { t } = useI18n()
const { createTransfer } = useTransactions()

function nowLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
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

function errKey(code: string): string {
  return t(`errors.${code}`) !== `errors.${code}` ? t(`errors.${code}`) : t('errors.UNKNOWN')
}

async function handleSubmit() {
  localError.value = ''
  serverError.value = ''

  if (fromAccountId.value === toAccountId.value) {
    localError.value = t('transfer.sameAccountError')
    return
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

  submitting.value = true
  try {
    await createTransfer(payload)
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
input,
select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  font-size: 0.95rem;
  background: var(--color-input-bg, #fff);
  color: var(--color-text, #000);
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
@media (max-width: 480px) {
  .row {
    flex-direction: column;
  }
  .ccy {
    width: 100%;
  }
}
</style>
