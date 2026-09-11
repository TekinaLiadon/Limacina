<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
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

const emit = defineEmits<{
  'animations-changed': [playing: boolean]
  'animation-finished': []
}>()

const container = ref<HTMLDivElement | null>(null)

const cpmData = toRef(props, 'cpmData')
const activeLayers = toRef(props, 'activeLayers')
const activeAnimations = computed((): CPMAnimation[] => props.activeAnimations ?? [])
const isAnimationPlaying = computed((): boolean => props.isAnimationPlaying ?? false)
const animationSpeed = computed((): number => props.animationSpeed ?? 1)
const isAnimationLooped = computed((): boolean => props.isAnimationLooped ?? false)

useCpmViewer(
  container,
  cpmData,
  activeLayers,
  useViewerControls(),
  activeAnimations,
  isAnimationPlaying,
  animationSpeed,
  isAnimationLooped,
  {
    onAnimationsChanged: (playing: boolean) => emit('animations-changed', playing),
    onAnimationFinished: () => emit('animation-finished'),
  },
)
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
