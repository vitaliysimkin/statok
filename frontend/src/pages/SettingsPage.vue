<template>
  <div class="settings-page">
    <h1 class="page-title">{{ t('settings.title') }}</h1>

    <!-- Appearance -->
    <section class="settings-section">
      <div class="settings-row">
        <span class="settings-label" id="locale-group-label">{{ t('settings.language') }}</span>
        <TButtonGroup
          :model-value="locale"
          :options="localeOptions"
          mandatory
          @update:model-value="setLocale($event as 'uk' | 'en')"
          :aria-labelledby="'locale-group-label'"
        />
      </div>

      <div class="settings-row">
        <span class="settings-label" id="theme-group-label">{{ t('settings.theme') }}</span>
        <TButtonGroup
          :model-value="theme"
          :options="themeOptions"
          mandatory
          @update:model-value="applyTheme($event as 'light' | 'dark' | 'auto')"
          :aria-labelledby="'theme-group-label'"
        />
      </div>
    </section>

    <!-- Config read-only -->
    <section class="settings-section">
      <div v-if="settingsLoading" class="muted">{{ t('common.loading') }}</div>
      <template v-else-if="settings">
        <div class="settings-row">
          <span class="settings-label">{{ t('settings.baseCurrency') }}</span>
          <span class="settings-value mono">{{ settings.baseCurrency }}</span>
        </div>
        <div class="settings-row">
          <span class="settings-label">{{ t('settings.version') }}</span>
          <span class="settings-value mono">{{ settings.version }}</span>
        </div>
      </template>
      <div v-else-if="settingsError" class="error-text">{{ settingsError }}</div>
    </section>

    <!-- Jobs -->
    <section class="settings-section" v-if="settings">
      <h2 class="section-title">{{ t('settings.jobs') }}</h2>
      <div
        v-for="(jobKey, i) in jobKeys"
        :key="jobKey"
        class="job-row"
        :class="{ 'job-row--sep': i > 0 }"
      >
        <div class="job-name">{{ t(`settings.job${jobKey.charAt(0).toUpperCase() + jobKey.slice(1)}`) }}</div>
        <div class="job-meta">
          <span class="job-field">
            <span class="muted">{{ t('settings.lastRunAt') }}:</span>
            {{ formatDt(settings.jobs[jobKey].lastRunAt) }}
          </span>
          <span class="job-field">
            <span class="muted">{{ t('settings.lastSuccessAt') }}:</span>
            {{ formatDt(settings.jobs[jobKey].lastSuccessAt) }}
          </span>
          <span class="job-field">
            <span class="muted">{{ t('settings.lastStatus') }}:</span>
            <span :class="statusClass(settings.jobs[jobKey].lastStatus)">
              {{ formatStatus(settings.jobs[jobKey].lastStatus) }}
            </span>
          </span>
          <span v-if="settings.jobs[jobKey].lastError" class="job-field error-text">
            <span class="muted">{{ t('settings.lastError') }}:</span>
            {{ settings.jobs[jobKey].lastError }}
          </span>
        </div>
      </div>
    </section>

    <!-- Actions -->
    <section class="settings-section">
      <h2 class="section-title">{{ t('common.actions') }}</h2>

      <div class="actions-grid">
        <button
          class="action-btn"
          :disabled="busy.prices"
          @click="doSyncPrices"
          :aria-label="t('settings.syncPrices')"
        >
          <span v-if="busy.prices">{{ t('settings.syncInProgress') }}</span>
          <span v-else-if="msgs.prices" class="action-msg">{{ msgs.prices }}</span>
          <span v-else>{{ t('settings.syncPrices') }}</span>
        </button>

        <button
          class="action-btn"
          :disabled="busy.fx"
          @click="doSyncFx"
          :aria-label="t('settings.syncFx')"
        >
          <span v-if="busy.fx">{{ t('settings.syncInProgress') }}</span>
          <span v-else-if="msgs.fx" class="action-msg">{{ msgs.fx }}</span>
          <span v-else>{{ t('settings.syncFx') }}</span>
        </button>

        <button
          class="action-btn"
          :disabled="busy.snapshot"
          @click="doRunSnapshot"
          :aria-label="t('settings.runSnapshot')"
        >
          <span v-if="busy.snapshot">{{ t('settings.syncInProgress') }}</span>
          <span v-else-if="msgs.snapshot" class="action-msg">{{ msgs.snapshot }}</span>
          <span v-else>{{ t('settings.runSnapshot') }}</span>
        </button>

        <button
          class="action-btn"
          :disabled="busy.backup"
          @click="doDownloadBackup"
          :aria-label="t('settings.downloadBackup')"
        >
          <span v-if="busy.backup">{{ t('settings.syncInProgress') }}</span>
          <span v-else-if="msgs.backup" class="action-msg">{{ msgs.backup }}</span>
          <span v-else>{{ t('settings.downloadBackup') }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { TButtonGroup } from '@vitaliysimkin/t-components'
import type { TButtonGroupOption } from '@vitaliysimkin/t-components'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import { useSettings } from '@/composables/useSettings'
import { errKey } from '@/services/api'
import type { JobState } from '@statok/shared'

const { t } = useI18n()
const { theme, applyTheme } = useTheme()
const { locale, setLocale } = useLocale()
const {
  settings,
  loading: settingsLoading,
  error: settingsError,
  fetchSettings,
  triggerPricesSync,
  triggerFxSync,
  triggerSnapshotRun,
} = useSettings()

const jobKeys = ['prices', 'fx', 'snapshot'] as const

const busy = reactive({ prices: false, fx: false, snapshot: false, backup: false })
const msgs = reactive({ prices: '', fx: '', snapshot: '', backup: '' })

const localeOptions = computed<TButtonGroupOption[]>(() => [
  { value: 'uk', label: t('settings.langUk') },
  { value: 'en', label: t('settings.langEn') },
])

const themeOptions = computed<TButtonGroupOption[]>(() => [
  { value: 'light', label: t('settings.themeLight') },
  { value: 'dark', label: t('settings.themeDark') },
  { value: 'auto', label: t('settings.themeAuto') },
])

function formatDt(dt: string | null): string {
  if (!dt) return t('jobs.never')
  try {
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(dt))
  } catch {
    return dt
  }
}

function formatStatus(s: JobState['lastStatus']): string {
  if (!s) return '—'
  if (s === 'ok') return t('settings.statusOk')
  if (s === 'error') return t('settings.statusError')
  return s
}

function statusClass(s: JobState['lastStatus']): string {
  if (s === 'ok') return 'status-ok'
  if (s === 'error') return 'status-err'
  return ''
}

interface SyncPricesResult {
  okCount: number
  errCount: number
  errors: Array<{ symbol: string; message: string }>
}

interface FxBranchResult {
  ok: boolean
  ratesUpserted: number
  error?: string
}

interface SyncFxResult {
  frankfurter: FxBranchResult
  nbu: FxBranchResult
}

async function doSyncPrices() {
  busy.prices = true
  msgs.prices = ''
  try {
    const res = (await triggerPricesSync()) as SyncPricesResult
    const ok = res.okCount ?? 0
    const err = res.errCount ?? 0
    msgs.prices = t('settings.syncPricesResult', { ok, err })
    await fetchSettings()
  } catch (e) {
    msgs.prices = t(errKey(e))
  } finally {
    busy.prices = false
  }
}

async function doSyncFx() {
  busy.fx = true
  msgs.fx = ''
  try {
    const res = (await triggerFxSync()) as SyncFxResult
    const fr = res.frankfurter?.ratesUpserted ?? 0
    const nbu = res.nbu?.ratesUpserted ?? 0
    msgs.fx = t('settings.syncFxResult', { fr, nbu })
    await fetchSettings()
  } catch (e) {
    msgs.fx = t(errKey(e))
  } finally {
    busy.fx = false
  }
}

async function doRunSnapshot() {
  busy.snapshot = true
  msgs.snapshot = ''
  try {
    await triggerSnapshotRun()
    msgs.snapshot = t('settings.snapshotDone', { date: new Date().toLocaleDateString(locale.value) })
    await fetchSettings()
  } catch (e) {
    msgs.snapshot = t(errKey(e))
  } finally {
    busy.snapshot = false
  }
}

async function doDownloadBackup() {
  busy.backup = true
  msgs.backup = ''
  try {
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3100'
    const res = await fetch(`${apiUrl}/api/backup/dump`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('statok_token') ?? ''}` },
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const blob = await res.blob()
    const cd = res.headers.get('content-disposition') ?? ''
    const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    const filename = match ? match[1].replace(/['"]/g, '') : 'statok-backup.dump'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    msgs.backup = t('common.success')
  } catch (e) {
    msgs.backup = (e as Error).message
  } finally {
    busy.backup = false
  }
}

onMounted(fetchSettings)
</script>

<style scoped>
.settings-page {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 20px;
}

.settings-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-secondary, #888);
  margin: 0 0 12px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.settings-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.settings-row:first-child {
  padding-top: 0;
}

.settings-label {
  font-size: 0.9rem;
  flex-shrink: 0;
}

.settings-value {
  font-size: 0.9rem;
  color: var(--color-text-secondary, #888);
}

.mono {
  font-family: monospace;
}

/* Jobs */
.job-row {
  padding: 10px 0;
}

.job-row--sep {
  border-top: 1px solid var(--color-border);
}

.job-name {
  font-size: 0.9rem;
  font-weight: 500;
  margin-bottom: 4px;
}

.job-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.job-field {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #888);
}

.muted {
  opacity: 0.65;
}

.status-ok {
  color: var(--color-success, #22c55e);
}

.status-err {
  color: var(--color-error, #ef4444);
}

.error-text {
  color: var(--color-error, #ef4444);
  font-size: 0.85rem;
}

/* Action buttons */
.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.action-btn {
  padding: 10px 14px;
  font-size: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: center;
  transition: background 0.1s;
  min-height: 42px;
  word-break: break-word;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-surface-hover, rgba(0,0,0,0.06));
}

.action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.action-msg {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #888);
}

/* Responsive 360px */
@media (max-width: 480px) {
  .settings-page {
    padding: 12px;
  }

  .settings-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .actions-grid {
    grid-template-columns: 1fr;
  }
}
</style>
