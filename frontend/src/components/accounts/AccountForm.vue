<template>
  <div class="account-form-overlay" @click.self="$emit('cancel')">
    <div class="account-form">
      <h2>{{ account ? t('accounts.editAccount') : t('accounts.newAccount') }}</h2>

      <form @submit.prevent="submit" novalidate>
        <div class="field">
          <label for="af-name">{{ t('accounts.name') }}</label>
          <input
            id="af-name"
            v-model="form.name"
            required
            :placeholder="t('accounts.name')"
            :aria-invalid="!!errorMsg"
            :aria-describedby="errorMsg ? 'af-error' : undefined"
          />
        </div>

        <div class="field">
          <label for="af-kind">{{ t('accounts.kind') }}</label>
          <select id="af-kind" v-model="form.kind">
            <option value="broker">{{ t('accounts.kindBroker') }}</option>
            <option value="exchange">{{ t('common.unknown') }}</option>
            <option value="bank">{{ t('accounts.kindBank') }}</option>
            <option value="wallet">{{ t('common.unknown') }}</option>
            <option value="other">{{ t('accounts.kindCash') }}</option>
          </select>
        </div>

        <div class="field">
          <label for="af-note">{{ t('common.note') }} <span class="optional">({{ t('common.optional') }})</span></label>
          <input id="af-note" v-model="form.note" :placeholder="t('common.note')" />
        </div>

        <template v-if="form.kind === 'bank'">
          <div class="field">
            <label for="af-rate">{{ t('accounts.interestRate') }}</label>
            <input id="af-rate" v-model="form.interestRatePercent" type="number" step="0.0001" min="0" :placeholder="t('common.optional')" />
          </div>
          <div class="field">
            <label for="af-term">{{ t('accounts.termEndDate') }}</label>
            <input id="af-term" v-model="form.termEndDate" type="date" />
          </div>
        </template>

        <div v-if="errorMsg" id="af-error" class="form-error" role="alert">{{ errorMsg }}</div>

        <div class="form-actions">
          <button type="button" class="btn-secondary" @click="$emit('cancel')">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? t('common.loading') : t('common.save') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccounts } from '@/composables/useAccounts'
import type { AccountWithBalances } from '@statok/shared'

const props = defineProps<{
  account?: AccountWithBalances | null
}>()

const emit = defineEmits<{
  saved: [account: AccountWithBalances]
  cancel: []
}>()

const { t } = useI18n()
const { create, update } = useAccounts()

const saving = ref(false)
const errorMsg = ref('')

const form = reactive({
  name: '',
  kind: 'broker' as string,
  note: '',
  interestRatePercent: '' as string,
  termEndDate: '' as string,
})

watch(
  () => props.account,
  (a) => {
    if (a) {
      form.name = a.name
      form.kind = a.kind
      form.note = a.note ?? ''
      form.interestRatePercent = a.interestRatePercent ?? ''
      form.termEndDate = a.termEndDate ?? ''
    } else {
      form.name = ''
      form.kind = 'broker'
      form.note = ''
      form.interestRatePercent = ''
      form.termEndDate = ''
    }
  },
  { immediate: true }
)

async function submit() {
  saving.value = true
  errorMsg.value = ''
  try {
    const payload = {
      name: form.name.trim(),
      kind: form.kind as any,
      note: form.note || undefined,
      interestRatePercent: form.kind === 'bank' && form.interestRatePercent ? form.interestRatePercent : undefined,
      termEndDate: form.kind === 'bank' && form.termEndDate ? form.termEndDate : undefined,
    }
    let saved: AccountWithBalances
    if (props.account) {
      saved = await update(props.account.id, payload)
    } else {
      saved = await create(payload)
    }
    emit('saved', saved)
  } catch (e: any) {
    errorMsg.value = e?.message ?? t('errors.UNKNOWN')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.account-form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.account-form {
  background: var(--color-surface, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.account-form h2 {
  margin: 0 0 1.25rem;
  font-size: 1.1rem;
}

.field {
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field label {
  font-size: 0.85rem;
  font-weight: 500;
  opacity: 0.75;
}

.optional {
  font-weight: 400;
  opacity: 0.6;
}

.field input,
.field select {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 5px;
  font-size: 0.95rem;
  background: var(--color-input, #fff);
  color: inherit;
}

.form-error {
  color: #c0392b;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1.25rem;
}

.btn-primary {
  padding: 0.5rem 1.25rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.95rem;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-secondary {
  padding: 0.5rem 1.25rem;
  background: transparent;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.95rem;
  color: inherit;
}
</style>
