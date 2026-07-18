<script setup lang="ts">
import { ref, watch } from 'vue'
import { useCpmViewer } from '@/04-features'
import type { CPMData } from '@/05-entities/core/types'

const props = defineProps<{
  cpmData: CPMData | null
  activeLayers: string[]
}>()

const container = ref<HTMLDivElement | null>(null)

const cpmData = ref<CPMData | null>(props.cpmData)
const activeLayers = ref<string[]>(props.activeLayers)
const zoomLevel = ref<number>(22)
const rotationY = ref<number>(0)

watch(() => props.cpmData, (data) => { cpmData.value = data })
watch(() => props.activeLayers, (layers) => { activeLayers.value = layers }, { deep: true })

useCpmViewer(container, cpmData, activeLayers, zoomLevel, rotationY)

function onZoomInput(e: Event): void {
  zoomLevel.value = Number((e.target as HTMLInputElement).value)
}

function onRotationInput(e: Event): void {
  rotationY.value = Number((e.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="cpm-viewer-wrapper">
    <div ref="container" class="cpm-viewer__canvas" />

    <input
      type="range"
      :value="zoomLevel"
      min="8"
      max="60"
      step="0.5"
      class="cpm-viewer__zoom"
      @input="onZoomInput"
    />

    <input
      type="range"
      :value="rotationY"
      min="0"
      max="360"
      step="1"
      class="cpm-viewer__rotation"
      @input="onRotationInput"
    />
  </div>
</template>

<style lang="scss">
.cpm-viewer-wrapper {
  position: relative;
  width: 100%;
}

.cpm-viewer__canvas {
  width: 100%;
  height: 360px;
  border-radius: 12px;
  overflow: hidden;
  background: #1a1d2e;

  canvas {
    display: block;
  }
}

.cpm-viewer__zoom {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 140px;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
  transform: rotate(-90deg);
  transform-origin: right top;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f0c040;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f0c040;
    cursor: pointer;
    border: none;
  }
}

.cpm-viewer__rotation {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f0c040;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f0c040;
    cursor: pointer;
    border: none;
  }
}
</style>
