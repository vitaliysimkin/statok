<template>
  <div class="price-history">
    <div class="ph-toolbar">
      <h4>{{ t('assets.priceHistory') }}</h4>
      <div class="ph-actions">
        <TButton
          v-if="showTickerChange"
          :label="t('assets.tickerChange')"
          mode="ghost"
          size="small"
          icon="system-uicons:pencil"
          @click="tickerChangeOpen = true"
        />
        <TButton
          :label="t('settings.syncPrices')"
          mode="ghost"
          size="small"
          icon="system-uicons:refresh"
          :disabled="syncing"
          @click="runSync"
        />
      </div>
    </div>

    <div v-if="loading" class="ph-msg">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="ph-err">{{ error }}</div>
    <template v-else>
      <!-- Manual add row -->
      <div class="ph-add-row">
        <TInput v-model="newDate" type="date" size="small" />
        <TInput v-model="newPrice" type="number" min="0" step="any" size="small" :placeholder="t('common.amount')" />
        <TButton
          :label="t('common.save')"
          variant="accent"
          size="small"
          :disabled="!newDate || !newPrice"
          @click="saveManual"
        />
      </div>

      <p v-if="!quotes.length" class="ph-msg">{{ t('common.noData') }}</p>
      <div v-else class="ph-scroll">
        <table class="ph-table">
          <thead>
            <tr>
              <th>{{ t('common.date') }}</th>
              <th class="num-col">{{ t('transactions.price') }}</th>
              <th>{{ t('assets.priceSource') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in sortedQuotes" :key="q.quoteDate">
              <td>{{ q.quoteDate }}</td>
              <td class="num-col">{{ q.price }}</td>
              <td>
                <TTag
                  :variant="q.source === 'manual' ? 'teal' : 'gray'"
                  size="small"
                >{{ q.source === 'manual' ? t('assets.priceSourceManual') : t('assets.priceSourceYahoo') }}</TTag>
              </td>
              <td class="action-col">
                <TButton
                  v-if="q.source === 'manual'"
                  icon="system-uicons:trash"
                  mode="ghost"
                  size="mini"
                  variant="danger"
                  @click="deleteRow(q.quoteDate)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Ticker-change dialog -->
    <div v-if="tickerChangeOpen" class="tc-overlay" role="dialog" aria-modal="true" aria-labelledby="tc-dialog-title" @click.self="tickerChangeOpen = false">
      <div class="tc-dialog">
        <h4 id="tc-dialog-title">{{ t('assets.tickerChange') }}</h4>
        <div class="field">
          <span class="field-label">{{ t('assets.tickerChangeFrom') }}</span>
          <p class="tc-from">{{ currentSymbol }}</p>
        </div>
        <div class="field">
          <label for="tc-new-symbol">{{ t('assets.tickerChangeTo') }}</label>
          <TInput id="tc-new-symbol" ref="tcFirstField" v-model="newSymbol" required />
        </div>
        <div class="field">
          <label for="tc-date">{{ t('common.date') }}</label>
          <TInput id="tc-date" v-model="tcDate" type="date" required />
        </div>
        <p v-if="tcErr" class="ph-err">{{ tcErr }}</p>
        <div class="tc-actions">
          <TButton
            :label="t('common.confirm')"
            variant="accent"
            :disabled="!newSymbol || !tcDate || tcSaving"
            @click="submitTickerChange"
          />
          <TButton :label="t('common.cancel')" mode="ghost" @click="tickerChangeOpen = false" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButton, TInput, TTag } from '@vitaliysimkin/t-components'
import { apiFetch } from '@/services/api'
import { usePrices } from '@/composables/usePrices'

const props = defineProps<{
  assetId: string
  currentSymbol: string
  showTickerChange?: boolean
}>()

const emit = defineEmits<{
  (e: 'ticker-changed', newSymbol: string): void
}>()

const { t } = useI18n()
const { quotes, loading, error, history, upsert, remove } = usePrices()

const newDate = ref('')
const newPrice = ref('')
const syncing = ref(false)

const tickerChangeOpen = ref(false)
const newSymbol = ref('')
const tcDate = ref(new Date().toISOString().slice(0, 10))
const tcErr = ref<string | null>(null)
const tcSaving = ref(false)
const tcFirstField = ref<{ inputRef?: HTMLInputElement } | null>(null)

const sortedQuotes = computed(() =>
  [...quotes.value].sort((a, b) => b.quoteDate.localeCompare(a.quoteDate)),
)

function onTcKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') tickerChangeOpen.value = false
}

watch(tickerChangeOpen, async (open) => {
  if (open) {
    window.addEventListener('keydown', onTcKeydown)
    await nextTick()
    tcFirstField.value?.inputRef?.focus()
  } else {
    window.removeEventListener('keydown', onTcKeydown)
  }
})

onMounted(() => history({ assetId: props.assetId }))
onBeforeUnmount(() => window.removeEventListener('keydown', onTcKeydown))

async function saveManual() {
  if (!newDate.value || !newPrice.value) return
  try {
    await upsert(props.assetId, newDate.value, newPrice.value)
    await history({ assetId: props.assetId })
    newDate.value = ''
    newPrice.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function deleteRow(date: string) {
  try {
    await remove(props.assetId, date)
    await history({ assetId: props.assetId })
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function runSync() {
  syncing.value = true
  try {
    const { sync } = usePrices()
    await sync(props.assetId)
    await history({ assetId: props.assetId })
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    syncing.value = false
  }
}

async function submitTickerChange() {
  tcErr.value = null
  tcSaving.value = true
  try {
    await apiFetch('/api/transactions/ticker-change', {
      method: 'POST',
      body: JSON.stringify({
        assetId: props.assetId,
        newSymbol: newSymbol.value.toUpperCase(),
        executedAt: new Date(tcDate.value).toISOString(),
      }),
    })
    tickerChangeOpen.value = false
    emit('ticker-changed', newSymbol.value.toUpperCase())
  } catch (e) {
    tcErr.value = (e as Error).message
  } finally {
    tcSaving.value = false
  }
}
</script>

<style scoped>
.price-history {
  position: relative;
}

.ph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.ph-toolbar h4 {
  margin: 0;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.ph-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.ph-add-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: flex-end;
  margin-bottom: 0.75rem;
}

.ph-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.ph-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  min-width: 260px;
}

.ph-table th,
.ph-table td {
  padding: 0.3rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--t-border, #e2e8f0);
}

.ph-table th {
  opacity: 0.6;
  font-weight: 600;
  font-size: 0.78rem;
}

.num-col {
  text-align: right;
}

.action-col {
  width: 40px;
  text-align: center;
}

.ph-msg {
  font-size: 0.85rem;
  opacity: 0.6;
}

.ph-err {
  font-size: 0.85rem;
  color: var(--t-danger, #e53e3e);
}

/* Ticker-change dialog */
.tc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
}

.tc-dialog {
  background: var(--t-bg, #fff);
  border-radius: 8px;
  padding: 1.25rem;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.tc-dialog h4 {
  margin: 0 0 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.field label,
.field-label {
  font-size: 0.85rem;
  opacity: 0.7;
}

.tc-from {
  margin: 0;
  font-weight: 600;
}

.tc-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}

@media (max-width: 400px) {
  .ph-add-row {
    flex-direction: column;
  }
  .tc-actions {
    flex-direction: column;
  }
}
</style>
