<template>
  <div ref="el" class="base-chart" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const props = defineProps<{
  data: uPlot.AlignedData
  options: uPlot.Options
}>()

const el = ref<HTMLDivElement | null>(null)
let chart: uPlot | null = null

function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function buildOptions(): uPlot.Options {
  return {
    ...props.options,
    width: el.value?.clientWidth ?? props.options.width ?? 300,
  }
}

function mount() {
  if (!el.value) return
  chart?.destroy()
  chart = new uPlot(buildOptions(), props.data, el.value)
}

function resize() {
  if (!el.value || !chart) return
  chart.setSize({ width: el.value.clientWidth, height: chart.height })
}

// Re-draw when data or options change
watch(() => [props.data, props.options], mount, { deep: true })

// Re-draw on theme change by watching CSS variable
let themeObserver: MutationObserver | null = null
onMounted(() => {
  mount()
  window.addEventListener('resize', resize)
  themeObserver = new MutationObserver(() => mount())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
})

onBeforeUnmount(() => {
  chart?.destroy()
  chart = null
  window.removeEventListener('resize', resize)
  themeObserver?.disconnect()
})

// Expose getVar so child charts can read CSS vars at mount time
defineExpose({ getVar })
</script>

<style scoped>
.base-chart {
  width: 100%;
  overflow: hidden;
}
</style>
