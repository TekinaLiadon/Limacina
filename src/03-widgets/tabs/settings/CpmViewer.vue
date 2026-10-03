<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
import { useCpmViewer } from '@/04-features'
import type { CPMData, CPMAnimation } from '@/05-entities'
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
  'playing-changed': [playing: boolean]
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
    onPlayingChanged: (playing: boolean) => emit('playing-changed', playing),
    onAnimationFinished: () => emit('animation-finished'),
  },
)
</script>

<template>
  <div ref="container" class="cpm-viewer__canvas" />
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-viewer__canvas {
  @include mixins.viewer-canvas;
}
</style>
