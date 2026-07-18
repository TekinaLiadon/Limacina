<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useSkinViewer } from '@/04-features'

const props = defineProps<{
  skinUrl: string
}>()

const container = ref<HTMLDivElement | null>(null)

const skinUrl = shallowRef(props.skinUrl)
watch(() => props.skinUrl, (url: string) => { skinUrl.value = url })

const zoomLevel = ref<number>(22)
const rotationY = ref<number>(0)

useSkinViewer(container, skinUrl, zoomLevel, rotationY)

function onZoomInput(e: Event): void {
  zoomLevel.value = Number((e.target as HTMLInputElement).value)
}

function onRotationInput(e: Event): void {
  rotationY.value = Number((e.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="skin-viewer-wrapper">
    <div ref="container" class="skin-viewer__canvas" />

    <input
      type="range"
      :value="zoomLevel"
      min="5"
      max="30"
      step="0.5"
      class="skin-viewer__zoom"
      @input="onZoomInput"
    />

    <input
      type="range"
      :value="rotationY"
      min="0"
      max="360"
      step="1"
      class="skin-viewer__rotation"
      @input="onRotationInput"
    />
  </div>
</template>

<style lang="scss">
.skin-viewer-wrapper {
  position: relative;
  width: 100%;
}

.skin-viewer__canvas {
  width: 100%;
  height: 360px;
  border-radius: 12px;
  overflow: hidden;
  background: #1a1d2e;

  canvas {
    display: block;
  }
}

.skin-viewer__zoom {
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

.skin-viewer__rotation {
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
