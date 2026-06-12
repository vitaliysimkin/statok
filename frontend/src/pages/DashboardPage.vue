<template>
  <div class="dashboard">
    <h1 class="dashboard__title">{{ t('dashboard.title') }}</h1>

    <!-- Net Worth section -->
    <section class="dashboard__section">
      <div class="dashboard__section-header">
        <h2>{{ t('dashboard.netWorth') }}</h2>
        <TButtonGroup
          v-model="activePeriod"
          :options="periodOptions"
          :mandatory="true"
          size="small"
        />
      </div>

      <div v-if="loading" class="dashboard__loading">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="dashboard__error">{{ t('common.error') }}: {{ error }}</div>
      <template v-else>
        <div v-if="networthPoints.length === 0" class="dashboard__empty">
          {{ t('dashboard.noSnapshots') }}
        </div>
        <template v-else>
          <div class="dashboard__current-value">
            {{ formattedCurrentValue }}
            <span class="dashboard__currency">{{ baseCurrency }}</span>
          </div>
          <NetWorthChart :points="networthPoints" :currency="baseCurrency" />
        </template>
      </template>
    </section>

    <!-- Cashflow section -->
    <section class="dashboard__section">
      <div class="dashboard__section-header">
        <h2>{{ t('dashboard.cashflow') }}</h2>
        <TButtonGroup
          v-model="activeGroupBy"
          :options="groupByOptions"
          :mandatory="true"
          size="small"
        />
      </div>

      <div
        v-if="cashflow?.valuationIncomplete"
        class="dashboard__valuation-badge"
        role="status"
      >
        {{ t('dashboard.valuationIncomplete') }}
      </div>

      <div v-if="cfLoading" class="dashboard__loading">{{ t('common.loading') }}</div>
      <div v-else-if="cfError" class="dashboard__error">{{ t('common.error') }}: {{ cfError }}</div>
      <template v-else>
        <div v-if="cashflowPeriods.length === 0" class="dashboard__empty">
          {{ t('common.noData') }}
        </div>
        <template v-else>
          <CashflowChart
            :periods="cashflowPeriods"
            :currency="baseCurrency"
            :label-deposits="t('dashboard.deposits')"
            :label-withdrawals="t('dashboard.withdrawals')"
            :label-net="t('dashboard.net')"
          />
          <div class="cashflow-table-wrap">
            <table class="cashflow-table" :aria-label="t('dashboard.cashflow')">
              <thead>
                <tr>
                  <th>{{ t('cashflow.period') }}</th>
                  <th>{{ t('cashflow.deposits') }}</th>
                  <th>{{ t('cashflow.withdrawals') }}</th>
                  <th>{{ t('cashflow.dividends') }}</th>
                  <th>{{ t('cashflow.coupons') }}</th>
                  <th>{{ t('cashflow.interest') }}</th>
                  <th>{{ t('cashflow.fees') }}</th>
                  <th>{{ t('cashflow.net') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in cashflowPeriods" :key="row.period">
                  <td>{{ row.period }}</td>
                  <td>{{ fmt(row.depositsMinor) }}</td>
                  <td>{{ fmt(row.withdrawalsMinor) }}</td>
                  <td>{{ fmt(row.dividendsMinor) }}</td>
                  <td>{{ fmt(row.couponsMinor) }}</td>
                  <td>{{ fmt(row.interestMinor) }}</td>
                  <td>{{ fmt(row.feesMinor) }}</td>
                  <td :class="row.netMinor >= 0 ? 'pos' : 'neg'">{{ fmt(row.netMinor) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButtonGroup } from '@vitaliysimkin/t-components'
import { useDashboards } from '@/composables/useDashboards'
import { formatMoney } from '@statok/shared'
import type { NetWorthSeriesPoint, CashflowPeriod } from '@statok/shared'
import NetWorthChart from '@/components/charts/NetWorthChart.vue'
import CashflowChart from '@/components/charts/CashflowChart.vue'

const { t, locale } = useI18n()

type PeriodKey = 'period1m' | 'period3m' | 'period1y' | 'periodAll'
type GroupBy = 'month' | 'quarter' | 'year'

const periodOptions = computed(() => [
  { value: 'period1m', label: t('dashboard.period1m') },
  { value: 'period3m', label: t('dashboard.period3m') },
  { value: 'period1y', label: t('dashboard.period1y') },
  { value: 'periodAll', label: t('dashboard.periodAll') },
])

const groupByOptions = computed(() => [
  { value: 'month', label: t('dashboard.groupByMonth') },
  { value: 'quarter', label: t('dashboard.groupByQuarter') },
  { value: 'year', label: t('dashboard.groupByYear') },
])

const activePeriod = ref<PeriodKey>('period1m')
const activeGroupBy = ref<GroupBy>('month')

const { networthSeries, cashflow, loading, error, fetchNetworthSeries, fetchCashflow } = useDashboards()

const cfLoading = ref(false)
const cfError = ref<string | null>(null)

const baseCurrency = computed(() => networthSeries.value?.baseCurrency ?? cashflow.value?.baseCurrency ?? 'USD')
const networthPoints = computed<NetWorthSeriesPoint[]>(() => networthSeries.value?.points ?? [])
const cashflowPeriods = computed<CashflowPeriod[]>(() => cashflow.value?.periods ?? [])

const formattedCurrentValue = computed(() => {
  const pts = networthPoints.value
  if (!pts.length) return '—'
  const last = pts[pts.length - 1]
  return formatMoney(last.totalMinor, baseCurrency.value, locale.value)
})

function fmt(minor: number): string {
  return formatMoney(minor, baseCurrency.value, locale.value)
}

function periodRange(key: PeriodKey): { from?: string; to?: string } {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const to = iso(today)
  if (key === 'period1m') {
    const f = new Date(today); f.setMonth(f.getMonth() - 1)
    return { from: iso(f), to }
  }
  if (key === 'period3m') {
    const f = new Date(today); f.setMonth(f.getMonth() - 3)
    return { from: iso(f), to }
  }
  if (key === 'period1y') {
    const f = new Date(today); f.setFullYear(f.getFullYear() - 1)
    return { from: iso(f), to }
  }
  return {}
}

watch(activePeriod, (key) => {
  fetchNetworthSeries(periodRange(key))
})

watch(activeGroupBy, async (g) => {
  cfLoading.value = true
  cfError.value = null
  try {
    await fetchCashflow({ groupBy: g })
  } catch (e) {
    cfError.value = (e as Error).message
  } finally {
    cfLoading.value = false
  }
})

onMounted(async () => {
  await Promise.all([
    fetchNetworthSeries(periodRange('period1m')),
    fetchCashflow({ groupBy: 'month' }),
  ])
})
</script>

<style scoped>
.dashboard {
  padding: 1rem;
  max-width: 900px;
  margin: 0 auto;
}
.dashboard__title {
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
}
.dashboard__section {
  margin-bottom: 2rem;
}
.dashboard__section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.dashboard__section-header h2 {
  margin: 0;
  font-size: 1.1rem;
}
.dashboard__loading,
.dashboard__error,
.dashboard__empty {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary, #aaa);
  font-size: 0.95rem;
}
.dashboard__error {
  color: var(--color-error, #f44336);
}
.dashboard__current-value {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.dashboard__currency {
  font-size: 1rem;
  color: var(--color-text-secondary, #aaa);
  margin-left: 0.25rem;
}
.dashboard__valuation-badge {
  display: inline-block;
  padding: 0.3rem 0.7rem;
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  margin-bottom: 0.75rem;
}
.cashflow-table-wrap {
  overflow-x: auto;
  margin-top: 1rem;
}
.cashflow-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  min-width: 480px;
}
.cashflow-table th,
.cashflow-table td {
  padding: 0.4rem 0.6rem;
  text-align: right;
  border-bottom: 1px solid var(--color-border, #333);
}
.cashflow-table th:first-child,
.cashflow-table td:first-child {
  text-align: left;
}
.cashflow-table th {
  color: var(--color-text-secondary, #aaa);
  font-weight: 600;
}
.pos { color: var(--color-success, #4caf50); }
.neg { color: var(--color-error, #f44336); }

@media (max-width: 480px) {
  .dashboard {
    padding: 0.5rem;
  }
  .dashboard__current-value {
    font-size: 1.5rem;
  }
  .dashboard__section-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
