<template>
  <div class="tx-table-wrap">
    <table class="tx-table" :aria-label="t('transactions.title')">
      <thead>
        <tr>
          <th>{{ t('transactions.date') }}</th>
          <th>{{ t('transactions.type') }}</th>
          <th>{{ t('transactions.account') }}</th>
          <th>{{ t('transactions.asset') }}</th>
          <th class="num">{{ t('transactions.quantity') }}</th>
          <th class="num">{{ t('transactions.price') }}</th>
          <th class="num">{{ t('transactions.amount') }}</th>
          <th class="actions-col">{{ t('common.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in items" :key="row.id">
          <td :data-label="t('transactions.date')">{{ formatDate(row.executedAt) }}</td>
          <td :data-label="t('transactions.type')">
            <span class="tx-type">{{ typeLabel(row.type) }}</span>
          </td>
          <td :data-label="t('transactions.account')">{{ row.accountName }}</td>
          <td :data-label="t('transactions.asset')">
            <span v-if="row.assetType !== 'cash'">{{ row.assetSymbol }}</span>
            <span v-else class="muted">—</span>
          </td>
          <td class="num" :data-label="t('transactions.quantity')">
            {{ row.quantity ?? '—' }}
          </td>
          <td class="num" :data-label="t('transactions.price')">
            {{ row.price ?? '—' }}
          </td>
          <td class="num" :data-label="t('transactions.amount')">
            {{ amountDisplay(row) }}
          </td>
          <td class="actions" :data-label="t('common.actions')">
            <TButton
              mode="text"
              size="mini"
              icon="system-uicons:pen"
              :label="t('common.edit')"
              :aria-label="t('common.edit')"
              @click="emit('edit', row)"
            />
            <TButton
              mode="text"
              size="mini"
              variant="danger"
              icon="system-uicons:trash"
              :label="t('common.delete')"
              :aria-label="t('common.delete')"
              @click="emit('delete', row)"
            />
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="8" class="empty-row">{{ t('transactions.noTransactions') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { TButton } from '@vitaliysimkin/t-components'
import { formatMoney } from '@statok/shared'
import type { TransactionListItem } from '@statok/shared'

defineProps<{ items: TransactionListItem[] }>()
const emit = defineEmits<{
  edit: [row: TransactionListItem]
  delete: [row: TransactionListItem]
}>()

const { t, locale } = useI18n()

const TYPE_KEY: Record<string, string> = {
  buy: 'transactions.typeBuy',
  sell: 'transactions.typeSell',
  deposit: 'transactions.typeDeposit',
  withdraw: 'transactions.typeWithdraw',
  dividend: 'transactions.typeDividend',
  coupon: 'transactions.typeCoupon',
  interest: 'transactions.typeInterest',
  split: 'transactions.typeSplit',
  transfer_in: 'transactions.typeTransferIn',
  transfer_out: 'transactions.typeTransferOut',
  ticker_change: 'transactions.typeTickerChange',
  opening_balance: 'transactions.typeOpeningBalance',
}

function typeLabel(type: string): string {
  const key = TYPE_KEY[type]
  return key ? t(key) : type
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value)
}

function amountDisplay(row: TransactionListItem): string {
  // Income types carry net rather than amount; show whichever applies.
  const minor = row.amountMinor ?? row.netMinor
  if (minor === null || minor === undefined) return '—'
  return formatMoney(minor, row.currency, locale.value)
}
</script>

<style scoped>
.tx-table-wrap {
  overflow-x: auto;
}
.tx-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.tx-table th,
.tx-table td {
  padding: 0.5rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border, #e2e2e2);
}
.tx-table th {
  font-weight: 600;
  white-space: nowrap;
  color: var(--color-text-muted, #555);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tx-type {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--color-chip-bg, rgba(37, 99, 235, 0.12));
  font-size: 0.8rem;
  white-space: nowrap;
}
.muted {
  color: var(--color-text-muted, #999);
}
.actions {
  white-space: nowrap;
  display: flex;
  gap: 0.25rem;
}
.empty-row {
  text-align: center;
  padding: 1.5rem;
  color: var(--color-text-muted, #999);
}

/* Stacked card layout on narrow screens (CRR-7, 360px) */
@media (max-width: 640px) {
  .tx-table,
  .tx-table thead,
  .tx-table tbody,
  .tx-table th,
  .tx-table td,
  .tx-table tr {
    display: block;
  }
  .tx-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .tx-table tr {
    margin-bottom: 0.75rem;
    border: 1px solid var(--color-border, #e2e2e2);
    border-radius: 8px;
    padding: 0.25rem 0.5rem;
  }
  .tx-table td {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: none;
    padding: 0.3rem 0.2rem;
    text-align: right;
  }
  .tx-table td::before {
    content: attr(data-label);
    font-weight: 600;
    color: var(--color-text-muted, #555);
    text-align: left;
  }
  .num {
    text-align: right;
  }
  .empty-row::before {
    content: none;
  }
}
</style>
