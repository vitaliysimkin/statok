<template>
  <div class="bond-panel">
    <section class="bond-section">
      <h4>{{ t('bond.details') }}</h4>
      <dl class="bond-details-grid">
        <dt>{{ t('bond.faceValue') }}</dt>
        <dd>{{ formatMoney(bond.faceValueMinor, currency, locale) }}</dd>

        <dt>{{ t('bond.couponFrequency') }}</dt>
        <dd>{{ freqLabel }}</dd>

        <template v-if="bond.couponFrequency > 0">
          <dt>{{ t('bond.couponRate') }}</dt>
          <dd>{{ bond.couponRatePercent }}%</dd>
        </template>

        <dt>{{ t('bond.maturityDate') }}</dt>
        <dd>{{ bond.maturityDate }}</dd>

        <template v-if="bond.issueDate">
          <dt>{{ t('bond.issueDate') }}</dt>
          <dd>{{ bond.issueDate }}</dd>
        </template>

        <template v-if="bond.isin">
          <dt>{{ t('bond.isin') }}</dt>
          <dd>{{ bond.isin }}</dd>
        </template>
      </dl>
    </section>

    <!-- Metrics -->
    <section class="bond-section">
      <h4>{{ t('bond.metrics') }}</h4>
      <div v-if="metricsLoading" class="loading-text">{{ t('common.loading') }}</div>
      <div v-else-if="metricsErr" class="err-text">{{ metricsErr }}</div>
      <dl v-else-if="metrics" class="bond-details-grid">
        <dt>{{ t('bond.ytm') }}</dt>
        <dd>{{ metrics.ytmPercent.toFixed(4) }}%</dd>

        <dt>{{ t('bond.currentYield') }}</dt>
        <dd>{{ metrics.currentYieldPercent.toFixed(4) }}%</dd>

        <dt>{{ t('bond.priceUsed') }}</dt>
        <dd>{{ metrics.priceUsed }}</dd>

        <dt>{{ t('bond.priceBasis') }}</dt>
        <dd>{{ metrics.priceBasis }}</dd>

        <dt>{{ t('bond.asOf') }}</dt>
        <dd>{{ metrics.asOf }}</dd>
      </dl>
    </section>

    <!-- Coupon schedule -->
    <section class="bond-section">
      <h4>{{ t('bond.schedule') }}</h4>
      <div v-if="scheduleLoading" class="loading-text">{{ t('common.loading') }}</div>
      <div v-else-if="scheduleErr" class="err-text">{{ scheduleErr }}</div>
      <p v-else-if="!schedule || schedule.items.length === 0" class="empty-text">{{ t('bond.noSchedule') }}</p>
      <div v-else class="schedule-scroll">
        <table class="schedule-table">
          <thead>
            <tr>
              <th>{{ t('bond.couponDate') }}</th>
              <th>{{ t('bond.couponKind') }}</th>
              <th class="amount-col">{{ t('bond.couponAmount') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in schedule.items"
              :key="row.date + row.kind"
              :class="{ 'row-future': row.isFuture, 'row-redemption': row.kind === 'redemption' }"
            >
              <td>{{ row.date }}</td>
              <td>{{ row.kind === 'coupon' ? t('bond.kindCoupon') : t('bond.kindRedemption') }}</td>
              <td class="amount-col">{{ formatMoney(row.amountMinor, schedule.currency, locale) }}</td>
              <td class="tag-col">
                <TTag v-if="row.isFuture" variant="blue" size="small">{{ t('bond.future') }}</TTag>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TTag } from '@vitaliysimkin/t-components'
import { formatMoney } from '@statok/shared'
import type { BondDetails, BondSchedule, BondMetrics } from '@statok/shared'
import { useAssets } from '@/composables/useAssets'

const props = defineProps<{
  assetId: string
  bond: BondDetails
  currency: string
}>()

const { t, locale } = useI18n()
const { bondSchedule, bondMetrics } = useAssets()

const schedule = ref<BondSchedule | null>(null)
const scheduleLoading = ref(false)
const scheduleErr = ref<string | null>(null)

const metrics = ref<BondMetrics | null>(null)
const metricsLoading = ref(false)
const metricsErr = ref<string | null>(null)

const freqLabel = computed(() => {
  const freq = props.bond.couponFrequency
  if (freq === 0) return t('bond.freqZero')
  if (freq === 1) return t('bond.freqAnnual')
  if (freq === 2) return t('bond.freqSemiAnnual')
  if (freq === 4) return t('bond.freqQuarterly')
  if (freq === 12) return t('bond.freqMonthly')
  return String(freq)
})

onMounted(async () => {
  scheduleLoading.value = true
  try {
    schedule.value = await bondSchedule(props.assetId)
  } catch (e) {
    scheduleErr.value = (e as Error).message
  } finally {
    scheduleLoading.value = false
  }

  metricsLoading.value = true
  try {
    metrics.value = await bondMetrics(props.assetId)
  } catch (e) {
    metricsErr.value = (e as Error).message
  } finally {
    metricsLoading.value = false
  }
})
</script>

<style scoped>
.bond-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.bond-section h4 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.bond-details-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
}

.bond-details-grid dt {
  font-size: 0.85rem;
  opacity: 0.7;
  white-space: nowrap;
}

.bond-details-grid dd {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
}

.schedule-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.schedule-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  min-width: 280px;
}

.schedule-table th,
.schedule-table td {
  padding: 0.3rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--t-border, #e2e8f0);
}

.schedule-table th {
  opacity: 0.6;
  font-weight: 600;
  font-size: 0.78rem;
}

.amount-col {
  text-align: right;
}

.tag-col {
  width: 70px;
}

.row-future td {
  opacity: 0.65;
}

.row-redemption td {
  font-weight: 600;
}

.loading-text,
.empty-text,
.err-text {
  font-size: 0.85rem;
  opacity: 0.6;
  padding: 0.25rem 0;
}

.err-text {
  color: var(--t-danger, #e53e3e);
  opacity: 1;
}
</style>
