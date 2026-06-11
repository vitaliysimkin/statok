<template>
  <div class="positions-table-wrap">
    <table class="positions-table" :aria-label="t('accountDetail.positions')">
      <thead>
        <tr>
          <th>{{ t('common.name') }}</th>
          <th class="num">{{ t('accountDetail.qty') }}</th>
          <th class="num">{{ t('accountDetail.avgCost') }}</th>
          <th class="num">{{ t('accountDetail.lastPrice') }}</th>
          <th class="num">{{ t('accountDetail.value') }}</th>
          <th class="num">{{ t('accountDetail.unrealized') }}</th>
          <th class="num">{{ t('accountDetail.unrealizedPct') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="pos in positions" :key="pos.asset.id + pos.accountId">
          <td>
            <div class="asset-name">{{ pos.asset.symbol }}</div>
            <div class="asset-sub">{{ pos.asset.name || pos.asset.type }}</div>
            <div v-if="pos.costBasisIncomplete" class="badge-warn">
              {{ t('accountDetail.costBasisIncomplete') }}
            </div>
          </td>
          <td class="num">{{ pos.quantity }}</td>
          <td class="num">{{ pos.avgCostMinor != null ? formatMoney(pos.avgCostMinor, pos.asset.currency, locale) : '—' }}</td>
          <td class="num">
            <span v-if="pos.lastPrice != null">
              {{ formatMoney(Math.round(parseFloat(pos.lastPrice) * 10 ** minorDigitsOf(pos.asset.currency)), pos.asset.currency, locale) }}
            </span>
            <span v-else class="muted">—</span>
            <div v-if="pos.priceDate" class="price-date">{{ pos.priceDate }}</div>
          </td>
          <td class="num">
            <span v-if="pos.valueMinor != null">{{ formatMoney(pos.valueMinor, pos.asset.currency, locale) }}</span>
            <span v-else class="muted">—</span>
          </td>
          <td class="num" :class="unrealizedClass(pos.unrealizedMinor)">
            <span v-if="pos.unrealizedMinor != null">{{ formatMoney(pos.unrealizedMinor, pos.asset.currency, locale) }}</span>
            <span v-else class="muted">—</span>
          </td>
          <td class="num" :class="unrealizedClass(pos.unrealizedMinor)">
            <span v-if="pos.unrealizedPct != null">{{ formatPct(pos.unrealizedPct) }}</span>
            <span v-else class="muted">—</span>
          </td>
        </tr>
        <tr v-if="positions.length === 0">
          <td colspan="7" class="empty">{{ t('accountDetail.noPositions') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatMoney, minorDigitsOf } from '@statok/shared'
import type { Position } from '@statok/shared'

defineProps<{
  positions: Position[]
}>()

const { t, locale } = useI18n()

function unrealizedClass(v: number | null | undefined): string {
  if (v == null) return ''
  return v > 0 ? 'positive' : v < 0 ? 'negative' : ''
}

function formatPct(pct: string | null): string {
  if (pct == null) return '—'
  const n = parseFloat(pct) * 100
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}
</script>

<style scoped>
.positions-table-wrap {
  overflow-x: auto;
}

.positions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.positions-table th,
.positions-table td {
  padding: 0.5rem 0.625rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #eee);
}

.positions-table th {
  font-size: 0.8rem;
  opacity: 0.65;
  font-weight: 600;
  white-space: nowrap;
}

.num {
  text-align: right;
}

.asset-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.asset-sub {
  font-size: 0.75rem;
  opacity: 0.55;
}

.price-date {
  font-size: 0.72rem;
  opacity: 0.5;
}

.badge-warn {
  font-size: 0.7rem;
  background: #fef3c7;
  color: #92400e;
  border-radius: 3px;
  padding: 1px 5px;
  margin-top: 2px;
  display: inline-block;
}

.muted {
  opacity: 0.35;
}

.empty {
  text-align: center;
  padding: 2rem;
  opacity: 0.45;
}

.positive {
  color: #16a34a;
}

.negative {
  color: #dc2626;
}
</style>
