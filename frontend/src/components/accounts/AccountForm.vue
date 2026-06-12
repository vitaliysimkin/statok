<template>
  <div class="account-form-overlay" @click.self="$emit('cancel')">
    <div class="account-form" role="dialog" aria-modal="true" :aria-label="account ? t('accounts.editAccount') : t('accounts.newAccount')">
      <h2>{{ account ? t('accounts.editAccount') : t('accounts.newAccount') }}</h2>

      <form @submit.prevent="submit" novalidate>
        <div class="field">
          <label for="af-name">{{ t('accounts.name') }}</label>
          <TInput
            id="af-name"
            ref="nameInput"
            v-model="form.name"
            required
            :placeholder="t('accounts.name')"
          />
        </div>

        <div class="field">
          <label for="af-kind">{{ t('accounts.kind') }}</label>
          <TSelect
            id="af-kind"
            v-model="form.kind"
            value-mode="value"
            :options="kindOptions"
          />
        </div>

        <div class="field">
          <label for="af-note">{{ t('common.note') }} <span class="optional">({{ t('common.optional') }})</span></label>
          <TInput id="af-note" v-model="form.note" :placeholder="t('common.note')" />
        </div>

        <template v-if="form.kind === 'bank'">
          <div class="field">
            <label for="af-rate">{{ t('accounts.interestRate') }}</label>
            <TInput id="af-rate" v-model="form.interestRatePercent" type="number" step="0.0001" min="0" :placeholder="t('common.optional')" />
          </div>
          <div class="field">
            <label for="af-term">{{ t('accounts.termEndDate') }}</label>
            <TInput id="af-term" v-model="form.termEndDate" type="date" />
          </div>
        </template>

        <div v-if="errorMsg" id="af-error" class="form-error" role="alert">{{ errorMsg }}</div>

        <div class="form-actions">
          <TButton type="button" :label="t('common.cancel')" mode="ghost" @click="$emit('cancel')" />
          <TButton type="submit" :label="saving ? t('common.loading') : t('common.save')" variant="accent" :disabled="saving" />
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { TInput, TSelect, TButton } from '@vitaliysimkin/t-components'
import { useAccounts } from '@/composables/useAccounts'
import { kindLabelKey } from '@/lib/accountKind'
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
const nameInput = ref<{ inputRef?: HTMLInputElement } | null>(null)

const KINDS = ['broker', 'exchange', 'bank', 'wallet', 'other'] as const

const kindOptions = computed(() =>
  KINDS.map((k) => ({ value: k, label: t(kindLabelKey(k)) })),
)

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
  { immediate: true },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('cancel')
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  nameInput.value?.inputRef?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

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

.form-error {
  color: var(--color-error, #c0392b);
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1.25rem;
}
</style>
