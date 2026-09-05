<script setup lang="ts">
import { ref, watch } from 'vue'
import { useCpmViewer } from '@/04-features'
import type { CPMData } from '@/05-entities/core/types'
import { useViewerControls } from './viewerControls'

const props = defineProps<{
  cpmData: CPMData | null
  activeLayers: string[]
}>()

const container = ref<HTMLDivElement | null>(null)

const cpmData = ref<CPMData | null>(props.cpmData)
const activeLayers = ref<string[]>(props.activeLayers)

watch(() => props.cpmData, (data) => { cpmData.value = data })
watch(() => props.activeLayers, (layers) => { activeLayers.value = layers }, { deep: true })

useCpmViewer(container, cpmData, activeLayers, useViewerControls())
</script>

<template>
  <div ref="container" class="cpm-viewer__canvas" />
</template>

<style lang="scss">
.cpm-viewer__canvas {
  width: 100%;
  height: 360px;
  border-radius: var(--radius-card);
  overflow: hidden;
  background: #1a1d2e;
  box-shadow: var(--elevation-inset);

  canvas {
    display: block;
  }
}
</style>
