<template>
  <div ref="el" class="cashflow-chart" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { CashflowPeriod } from '@statok/shared'
import { minorToDisplay } from '@statok/shared'

function toNum(minor: number, ccy: string): number {
  return parseFloat(minorToDisplay(minor, ccy))
}

const props = defineProps<{
  periods: CashflowPeriod[]
  currency: string
  labelDeposits: string
  labelWithdrawals: string
  labelNet: string
}>()

const el = ref<HTMLDivElement | null>(null)
let chart: uPlot | null = null
let themeObserver: MutationObserver | null = null
let ro: ResizeObserver | null = null

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
}

function buildChart() {
  if (!el.value) return
  chart?.destroy()

  const ps = props.periods
  const xs = ps.map((_, i) => i)
  const deposits = ps.map(p => toNum(p.depositsMinor, props.currency))
  const withdrawals = ps.map(p => -toNum(p.withdrawalsMinor, props.currency))
  const net = ps.map(p => toNum(p.netMinor, props.currency))

  const colorDeposit = cssVar('--color-success') || cssVar('--t-color-success') || '#4caf50'
  const colorWithdraw = cssVar('--color-error') || cssVar('--t-color-error') || '#f44336'
  const colorNet = cssVar('--color-accent') || cssVar('--t-color-accent') || '#4f8ef7'
  const gridColor = cssVar('--color-border') || cssVar('--t-color-border') || '#333'
  const textColor = cssVar('--color-text-secondary') || cssVar('--t-color-text-secondary') || '#aaa'

  const w = el.value.clientWidth || 320
  const bars = uPlot.paths.bars!({ size: [0.6, Infinity] })

  const opts: uPlot.Options = {
    width: w,
    height: 200,
    cursor: { show: true },
    legend: { show: false },
    axes: [
      {
        stroke: textColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor },
        values: (_u, vals) => vals.map(v => ps[v as number]?.period ?? ''),
        splits: (_u, _ax, _min, _max, _incr) => xs,
      },
      {
        stroke: textColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor },
        values: (_u, vals) => vals.map(v => v == null ? '' : (v as number).toFixed(0)),
      },
    ],
    series: [
      {},
      {
        label: props.labelDeposits,
        stroke: colorDeposit,
        fill: colorDeposit + 'aa',
        paths: bars,
        points: { show: false },
      },
      {
        label: props.labelWithdrawals,
        stroke: colorWithdraw,
        fill: colorWithdraw + 'aa',
        paths: bars,
        points: { show: false },
      },
      {
        label: props.labelNet,
        stroke: colorNet,
        width: 2,
        points: { show: true, size: 5 },
      },
    ],
  }

  chart = new uPlot(opts, [xs, deposits, withdrawals, net], el.value)
}

function resize() {
  if (!el.value || !chart) return
  chart.setSize({ width: el.value.clientWidth, height: chart.height })
}

watch(
  () => [props.periods, props.currency, props.labelDeposits, props.labelWithdrawals, props.labelNet],
  buildChart,
  { deep: true },
)

onMounted(() => {
  buildChart()
  ro = new ResizeObserver(resize)
  if (el.value) ro.observe(el.value)
  themeObserver = new MutationObserver(buildChart)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  chart?.destroy()
  chart = null
  ro?.disconnect()
  themeObserver?.disconnect()
})
</script>

<style scoped>
.cashflow-chart {
  width: 100%;
  overflow: hidden;
}
</style>
