<template>
  <div class="assets-page">
    <div class="page-header">
      <h1>{{ t('assets.title') }}</h1>
      <TButton
        :label="t('assets.newAsset')"
        variant="accent"
        icon="system-uicons:plus"
        @click="openCreate"
      />
    </div>

    <!-- Filter by type -->
    <div class="filter-bar">
      <TButtonGroup
        v-model="typeFilter"
        :options="typeOptions"
        size="small"
        mandatory
      />
      <TSwitch
        v-model="showArchived"
        :label="t('assets.includeArchived')"
        size="small"
        class="archived-toggle"
      />
    </div>

    <div v-if="loading" class="page-msg">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="page-err">{{ error }}</div>
    <div v-else-if="!filteredAssets.length" class="page-msg">{{ t('assets.noAssets') }}</div>

    <!-- Asset list -->
    <div v-else class="asset-list">
      <div
        v-for="a in filteredAssets"
        :key="a.id"
        class="asset-card"
        :class="{ archived: !!a.archivedAt, expanded: selectedId === a.id }"
      >
        <div
          class="asset-card-header"
          role="button"
          tabindex="0"
          :aria-expanded="selectedId === a.id"
          :aria-label="a.symbol + ' ' + a.name"
          @click="toggleSelect(a.id)"
          @keydown.enter.space.prevent="toggleSelect(a.id)"
        >
          <div class="asset-card-main">
            <span class="asset-symbol">{{ a.symbol }}</span>
            <span class="asset-name">{{ a.name }}</span>
            <TTag variant="gray" size="small">{{ typeLabel(a.type) }}</TTag>
            <TTag v-if="a.archivedAt" variant="yellow" size="small">{{ t('assets.archived') }}</TTag>
          </div>
          <div class="asset-card-meta">
            <span class="asset-currency">{{ a.currency }}</span>
            <span class="asset-source">{{ priceSourceLabel(a.priceSource) }}</span>
          </div>
          <div class="asset-card-actions" @click.stop>
            <TButton icon="system-uicons:pencil" mode="ghost" size="mini" :aria-label="t('common.edit')" @click="openEdit(a)" />
            <TButton
              :icon="a.archivedAt ? 'system-uicons:undo' : 'system-uicons:box'"
              mode="ghost"
              size="mini"
              :aria-label="a.archivedAt ? t('common.restore') : t('accounts.archiveAccount')"
              @click="toggleArchive(a)"
            />
            <TButton
              icon="system-uicons:trash"
              mode="ghost"
              size="mini"
              variant="danger"
              :aria-label="t('common.delete')"
              @click="confirmDelete(a)"
            />
          </div>
        </div>

        <!-- Expanded detail panel -->
        <div v-if="selectedId === a.id" class="asset-detail">
          <!-- Bond panel -->
          <BondPanel
            v-if="a.type === 'bond' && a.bond"
            :assetId="a.id"
            :bond="a.bond"
            :currency="a.currency"
            class="detail-section"
          />

          <!-- Price history -->
          <PriceHistory
            :assetId="a.id"
            :currentSymbol="a.symbol"
            :showTickerChange="a.type !== 'cash'"
            class="detail-section"
            @ticker-changed="onTickerChanged(a.id, $event)"
          />
        </div>
      </div>
    </div>

    <!-- Create/Edit form dialog -->
    <div v-if="formOpen" class="dialog-overlay" role="dialog" aria-modal="true" :aria-label="editingAsset ? t('assets.editAsset') : t('assets.newAsset')" @click.self="closeForm">
      <div class="dialog-box">
        <AssetForm
          :asset="editingAsset"
          @save="handleSave"
          @cancel="closeForm"
        />
        <p v-if="formErr" class="page-err">{{ formErr }}</p>
      </div>
    </div>

    <!-- Delete confirm dialog -->
    <div v-if="deleteTarget" class="dialog-overlay" role="dialog" aria-modal="true" :aria-label="t('assets.deleteConfirm', { symbol: deleteTarget?.symbol })" @click.self="deleteTarget = null">
      <div ref="deleteBox" class="dialog-box confirm-box">
        <p>{{ t('assets.deleteConfirm', { symbol: deleteTarget.symbol }) }}</p>
        <div class="confirm-actions">
          <TButton :label="t('common.delete')" variant="danger" @click="doDelete" />
          <TButton :label="t('common.cancel')" mode="ghost" @click="deleteTarget = null" />
        </div>
        <p v-if="deleteErr" class="page-err">{{ deleteErr }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButton, TTag, TButtonGroup, TSwitch } from '@vitaliysimkin/t-components'
import type { Asset, CreateAssetRequest, UpdateAssetRequest } from '@statok/shared'
import { useAssets } from '@/composables/useAssets'
import AssetForm from '@/components/assets/AssetForm.vue'
import BondPanel from '@/components/assets/BondPanel.vue'
import PriceHistory from '@/components/assets/PriceHistory.vue'

const { t } = useI18n()
const { assets, loading, error, list, create, update } = useAssets()

const typeFilter = ref<string | number | null>('all')
const showArchived = ref(false)
const selectedId = ref<string | null>(null)

const formOpen = ref(false)
const editingAsset = ref<Asset | null>(null)
const formErr = ref<string | null>(null)

const deleteTarget = ref<Asset | null>(null)
const deleteErr = ref<string | null>(null)
const deleteBox = ref<HTMLElement | null>(null)

const typeOptions = computed(() => [
  { value: 'all', label: t('common.all') },
  { value: 'stock', label: t('assets.typeStock') },
  { value: 'etf', label: t('assets.typeEtf') },
  { value: 'bond', label: t('assets.typeBond') },
  { value: 'crypto', label: t('assets.typeCrypto') },
  { value: 'cash', label: t('assets.typeCash') },
])

const filteredAssets = computed(() => {
  let list_ = assets.value
  if (!showArchived.value) list_ = list_.filter((a) => !a.archivedAt)
  if (typeFilter.value !== 'all') list_ = list_.filter((a) => a.type === typeFilter.value)
  return list_
})

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    stock: t('assets.typeStock'),
    etf: t('assets.typeEtf'),
    bond: t('assets.typeBond'),
    crypto: t('assets.typeCrypto'),
    cash: t('assets.typeCash'),
  }
  return map[type] ?? type
}

function priceSourceLabel(source: string): string {
  return source === 'manual' ? t('assets.priceSourceManual') : t('assets.priceSourceYahoo')
}

function toggleSelect(id: string) {
  selectedId.value = selectedId.value === id ? null : id
}

function openCreate() {
  editingAsset.value = null
  formErr.value = null
  formOpen.value = true
}

function openEdit(a: Asset) {
  editingAsset.value = a
  formErr.value = null
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingAsset.value = null
  formErr.value = null
}

async function handleSave(req: CreateAssetRequest | UpdateAssetRequest, id?: string) {
  formErr.value = null
  try {
    if (id) {
      await update(id, req as UpdateAssetRequest)
    } else {
      await create(req as CreateAssetRequest)
    }
    closeForm()
    await list({ archived: showArchived.value || undefined })
  } catch (e) {
    formErr.value = (e as Error).message
  }
}

async function toggleArchive(a: Asset) {
  try {
    await update(a.id, { archived: !a.archivedAt })
    await list({ archived: showArchived.value || undefined })
  } catch (e) {
    error.value = (e as Error).message
  }
}

function confirmDelete(a: Asset) {
  deleteTarget.value = a
  deleteErr.value = null
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleteErr.value = null
  try {
    const { apiFetch } = await import('@/services/api')
    await apiFetch(`/api/assets/${deleteTarget.value.id}`, { method: 'DELETE' })
    deleteTarget.value = null
    await list({ archived: showArchived.value || undefined })
  } catch (e) {
    deleteErr.value = (e as Error).message
  }
}

function onTickerChanged(id: string, newSymbol: string) {
  const a = assets.value.find((x) => x.id === id)
  if (a) a.symbol = newSymbol
}

function onDialogKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (deleteTarget.value) deleteTarget.value = null
  else if (formOpen.value) closeForm()
}

watch(
  () => formOpen.value || !!deleteTarget.value,
  (open) => {
    if (open) window.addEventListener('keydown', onDialogKeydown)
    else window.removeEventListener('keydown', onDialogKeydown)
  },
)

watch(deleteTarget, async (target) => {
  if (!target) return
  await nextTick()
  deleteBox.value?.querySelector('button')?.focus()
})

onMounted(() => list())
onBeforeUnmount(() => window.removeEventListener('keydown', onDialogKeydown))
</script>

<style scoped>
.assets-page {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.page-header h1 {
  margin: 0;
  font-size: 1.4rem;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-bottom: 1rem;
}

.archived-toggle {
  margin-left: auto;
}

.asset-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.asset-card {
  border: 1px solid var(--t-border, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.asset-card.archived {
  opacity: 0.6;
}

.asset-card-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  cursor: pointer;
  user-select: none;
  background: var(--t-surface, #fff);
}

.asset-card-header:hover {
  background: var(--t-hover, #f7fafc);
}

.asset-card-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.asset-symbol {
  font-weight: 700;
  font-size: 0.95rem;
}

.asset-name {
  font-size: 0.85rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.asset-card-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.8rem;
  opacity: 0.6;
}

.asset-card-actions {
  display: flex;
  gap: 0.2rem;
}

.asset-detail {
  padding: 1rem;
  border-top: 1px solid var(--t-border, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background: var(--t-bg-subtle, #f9fafb);
}

.detail-section {
  /* each sub-panel */
}

/* Dialogs */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.dialog-box {
  background: var(--t-bg, #fff);
  border-radius: 8px;
  padding: 1.5rem;
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.confirm-box {
  max-width: 360px;
}

.confirm-box p {
  margin-top: 0;
}

.confirm-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}

.page-msg {
  font-size: 0.9rem;
  opacity: 0.6;
  padding: 1rem 0;
}

.page-err {
  font-size: 0.85rem;
  color: var(--t-danger, #e53e3e);
  margin-top: 0.5rem;
}

/* Responsive */
@media (max-width: 400px) {
  .page-header h1 {
    font-size: 1.2rem;
  }

  .asset-card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .asset-card-actions {
    align-self: flex-end;
  }

  .confirm-actions {
    flex-direction: column;
  }

  .dialog-box {
    padding: 1rem;
  }
}
</style>
