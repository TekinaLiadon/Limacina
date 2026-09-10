<script setup lang="ts">
import { ref, watch } from 'vue'
import { useCpmViewer } from '@/04-features'
import type { CPMData, CPMAnimation } from '@/05-entities/core/types'
import { useViewerControls } from './viewerControls'

const props = defineProps<{
  cpmData: CPMData | null
  activeLayers: number[]
  activeAnimations?: CPMAnimation[]
  isAnimationPlaying?: boolean
  animationSpeed?: number
  isAnimationLooped?: boolean
}>()

const container = ref<HTMLDivElement | null>(null)

const cpmData = ref<CPMData | null>(props.cpmData)
const activeLayers = ref<number[]>(props.activeLayers)
const activeAnimations = ref<CPMAnimation[]>(props.activeAnimations ?? [])
const isAnimationPlaying = ref<boolean>(props.isAnimationPlaying ?? false)
const animationSpeed = ref<number>(props.animationSpeed ?? 1)
const isAnimationLooped = ref<boolean>(props.isAnimationLooped ?? false)

watch(() => props.cpmData, (data) => { cpmData.value = data })
watch(() => props.activeLayers, (layers) => { activeLayers.value = layers }, { deep: true })
watch(() => props.activeAnimations, (animations) => { activeAnimations.value = animations ?? [] }, { deep: true })
watch(() => props.isAnimationPlaying, (playing) => { isAnimationPlaying.value = playing ?? false })
watch(() => props.animationSpeed, (speed) => { animationSpeed.value = speed ?? 1 })
watch(() => props.isAnimationLooped, (looped) => { isAnimationLooped.value = looped ?? false })

useCpmViewer(container, cpmData, activeLayers, useViewerControls(), activeAnimations, isAnimationPlaying, animationSpeed, isAnimationLooped)
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
