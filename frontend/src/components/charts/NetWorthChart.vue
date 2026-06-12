<template>
  <div ref="el" class="net-worth-chart" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { NetWorthSeriesPoint } from '@statok/shared'
import { minorToDisplay } from '@statok/shared'

function toNum(minor: number, ccy: string): number {
  return parseFloat(minorToDisplay(minor, ccy))
}

const props = defineProps<{
  points: NetWorthSeriesPoint[]
  currency: string
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

  const pts = props.points
  const xs = pts.map(p => new Date(p.date).getTime() / 1000)
  const ys = pts.map(p => toNum(p.totalMinor, props.currency))

  const lineColor = cssVar('--color-accent') || cssVar('--t-color-accent') || '#4f8ef7'
  const gridColor = cssVar('--color-border') || cssVar('--t-color-border') || '#333'
  const textColor = cssVar('--color-text-secondary') || cssVar('--t-color-text-secondary') || '#aaa'

  const w = el.value.clientWidth || 320

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
      },
      {
        stroke: textColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor },
        values: (_u, vals) => vals.map(v => v == null ? '' : `${props.currency} ${(v as number).toFixed(0)}`),
      },
    ],
    series: [
      {},
      {
        stroke: lineColor,
        width: 2,
        fill: lineColor + '22',
      },
    ],
  }

  chart = new uPlot(opts, [xs, ys], el.value)
}

function resize() {
  if (!el.value || !chart) return
  chart.setSize({ width: el.value.clientWidth, height: chart.height })
}

watch(() => [props.points, props.currency], buildChart, { deep: true })

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
.net-worth-chart {
  width: 100%;
  overflow: hidden;
}
</style>
