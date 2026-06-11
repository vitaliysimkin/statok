<template>
  <div class="asset-form">
    <h3>{{ asset ? t('assets.editAsset') : t('assets.newAsset') }}</h3>

    <form @submit.prevent="submit">
      <!-- symbol — read-only on edit -->
      <div class="field">
        <label for="af-symbol">{{ t('assets.symbol') }}</label>
        <TInput id="af-symbol" v-model="form.symbol" :disabled="!!asset" required />
      </div>

      <div class="field">
        <label for="af-name">{{ t('assets.name') }}</label>
        <TInput id="af-name" v-model="form.name" />
      </div>

      <div class="field">
        <label for="af-type">{{ t('assets.type') }}</label>
        <select id="af-type" v-model="form.type" :disabled="!!asset" required>
          <option value="stock">{{ t('assets.typeStock') }}</option>
          <option value="etf">{{ t('assets.typeEtf') }}</option>
          <option value="bond">{{ t('assets.typeBond') }}</option>
          <option value="crypto">{{ t('assets.typeCrypto') }}</option>
        </select>
      </div>

      <div class="field">
        <label for="af-currency">{{ t('assets.currency') }}</label>
        <TInput id="af-currency" v-model="form.currency" maxlength="3" required />
      </div>

      <div class="field">
        <label for="af-price-source">{{ t('assets.priceSource') }}</label>
        <select id="af-price-source" v-model="form.priceSource">
          <option value="yahoo">{{ t('assets.priceSourceYahoo') }}</option>
          <option value="manual">{{ t('assets.priceSourceManual') }}</option>
        </select>
      </div>

      <!-- Bond block -->
      <template v-if="form.type === 'bond'">
        <hr class="section-divider" />
        <h4>{{ t('bond.details') }}</h4>

        <div class="field">
          <label for="af-face">{{ t('bond.faceValue') }}</label>
          <TInput id="af-face" v-model="bondForm.faceValueDisplay" type="number" min="0.01" step="0.01" required />
        </div>

        <div class="field">
          <label for="af-freq">{{ t('bond.couponFrequency') }}</label>
          <select id="af-freq" v-model.number="bondForm.couponFrequency" required>
            <option :value="0">{{ t('bond.freqZero') }}</option>
            <option :value="1">{{ t('bond.freqAnnual') }}</option>
            <option :value="2">{{ t('bond.freqSemiAnnual') }}</option>
            <option :value="4">{{ t('bond.freqQuarterly') }}</option>
            <option :value="12">{{ t('bond.freqMonthly') }}</option>
          </select>
        </div>

        <div v-if="bondForm.couponFrequency > 0" class="field">
          <label for="af-rate">{{ t('bond.couponRate') }}</label>
          <TInput id="af-rate" v-model="bondForm.couponRatePercent" type="number" min="0" step="0.0001" required />
        </div>

        <div class="field">
          <label for="af-maturity">{{ t('bond.maturityDate') }}</label>
          <TInput id="af-maturity" v-model="bondForm.maturityDate" type="date" required />
        </div>

        <div class="field">
          <label for="af-issue">{{ t('bond.issueDate') }} ({{ t('common.optional') }})</label>
          <TInput id="af-issue" v-model="bondForm.issueDate" type="date" />
        </div>

        <div class="field">
          <label for="af-isin">{{ t('bond.isin') }} ({{ t('common.optional') }})</label>
          <TInput id="af-isin" v-model="bondForm.isin" maxlength="12" />
        </div>
      </template>

      <p v-if="err" class="form-error" role="alert">{{ err }}</p>

      <div class="form-actions">
        <TButton type="submit" :label="t('common.save')" variant="accent" :disabled="saving" />
        <TButton type="button" :label="t('common.cancel')" mode="ghost" @click="$emit('cancel')" />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TInput, TButton } from '@vitaliysimkin/t-components'
import { displayToMinor, minorToDisplay } from '@statok/shared'
import type { Asset, CreateAssetRequest, UpdateAssetRequest } from '@statok/shared'

const props = defineProps<{
  asset?: Asset | null
}>()

const emit = defineEmits<{
  (e: 'save', req: CreateAssetRequest | UpdateAssetRequest, id?: string): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()

const saving = ref(false)
const err = ref<string | null>(null)

const form = reactive({
  symbol: '',
  name: '',
  type: 'stock' as string,
  currency: 'USD',
  priceSource: 'yahoo' as string,
})

const bondForm = reactive({
  faceValueDisplay: '1000',
  couponFrequency: 1,
  couponRatePercent: '0',
  maturityDate: '',
  issueDate: '',
  isin: '',
})

watch(
  () => props.asset,
  (a) => {
    if (!a) {
      form.symbol = ''
      form.name = ''
      form.type = 'stock'
      form.currency = 'USD'
      form.priceSource = 'yahoo'
      return
    }
    form.symbol = a.symbol
    form.name = a.name
    form.type = a.type
    form.currency = a.currency
    form.priceSource = a.priceSource
    if (a.bond) {
      bondForm.faceValueDisplay = minorToDisplay(a.bond.faceValueMinor, a.currency)
      bondForm.couponFrequency = a.bond.couponFrequency
      bondForm.couponRatePercent = a.bond.couponRatePercent
      bondForm.maturityDate = a.bond.maturityDate
      bondForm.issueDate = a.bond.issueDate ?? ''
      bondForm.isin = a.bond.isin ?? ''
    }
  },
  { immediate: true },
)

function submit() {
  err.value = null
  saving.value = true
  try {
    if (props.asset) {
      // update
      const req: UpdateAssetRequest = {
        name: form.name || undefined,
        currency: form.currency || undefined,
        priceSource: form.priceSource as any,
      }
      if (form.type === 'bond') {
        req.bond = {
          faceValueMinor: displayToMinor(bondForm.faceValueDisplay || '0', form.currency),
          couponFrequency: bondForm.couponFrequency,
          couponRatePercent:
            bondForm.couponFrequency === 0 ? '0' : bondForm.couponRatePercent,
          maturityDate: bondForm.maturityDate,
          issueDate: bondForm.issueDate || null,
          isin: bondForm.isin || null,
        }
      }
      emit('save', req, props.asset.id)
    } else {
      // create
      const req: CreateAssetRequest = {
        type: form.type as any,
        symbol: form.symbol.toUpperCase(),
        name: form.name || undefined,
        currency: form.currency.toUpperCase(),
        priceSource: form.priceSource as any,
      }
      if (form.type === 'bond') {
        req.bond = {
          faceValueMinor: displayToMinor(bondForm.faceValueDisplay || '0', form.currency),
          couponFrequency: bondForm.couponFrequency,
          couponRatePercent:
            bondForm.couponFrequency === 0 ? '0' : bondForm.couponRatePercent,
          maturityDate: bondForm.maturityDate,
          issueDate: bondForm.issueDate || null,
          isin: bondForm.isin || null,
        }
      }
      emit('save', req)
    }
  } catch (e) {
    err.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.asset-form {
  max-width: 480px;
  padding: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.field label {
  font-size: 0.85rem;
  font-weight: 500;
  opacity: 0.8;
}

.field select {
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  border: 1px solid var(--t-border, #ccc);
  background: var(--t-bg, #fff);
  font-size: 0.95rem;
}

.section-divider {
  margin: 1rem 0;
  opacity: 0.3;
}

.form-error {
  color: var(--t-danger, #e53e3e);
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}

@media (max-width: 400px) {
  .asset-form {
    padding: 0.75rem;
  }
  .form-actions {
    flex-direction: column;
  }
}
</style>
