<script setup lang="ts">
import { ref, computed, toRef } from 'vue'
import {
  useCpmViewer,
  type ActiveCpmAnimation,
  type CpmEditorBridge,
  type CpmViewerOptions,
} from '@/04-features'
import type { CPMData } from '@/05-entities'
import { useViewerControls } from './viewerControls'

const props = defineProps<{
  cpmData: CPMData | null
  activeLayers: number[]
  activeAnimations?: ActiveCpmAnimation[]
  isAnimationPlaying?: boolean
  animationSpeed?: number
  isAnimationLooped?: boolean
  editorBridge?: CpmEditorBridge | null
  isEditing?: boolean
  selectedBoneId?: number | null
}>()

const emit = defineEmits<{
  'playing-changed': [playing: boolean]
  'animation-finished': []
  'load-error': []
  'bone-picked': [storeId: number | null]
}>()

const container = ref<HTMLDivElement | null>(null)

const cpmData = toRef(props, 'cpmData')
const activeLayers = toRef(props, 'activeLayers')
const activeAnimations = computed((): ActiveCpmAnimation[] => props.activeAnimations ?? [])
const isAnimationPlaying = computed((): boolean => props.isAnimationPlaying ?? false)
const animationSpeed = computed((): number => props.animationSpeed ?? 1)
const isAnimationLooped = computed((): boolean => props.isAnimationLooped ?? false)
const isEditing = computed((): boolean => props.isEditing ?? false)
const selectedBoneId = computed((): number | null => props.selectedBoneId ?? null)

const viewerOptions: CpmViewerOptions = {
  onPlayingChanged: (playing: boolean) => emit('playing-changed', playing),
  onAnimationFinished: () => emit('animation-finished'),
  onTextureError: () => emit('load-error'),
}

if (props.editorBridge) {
  viewerOptions.editor = {
    bridge: props.editorBridge,
    isEditing,
    selectedBoneId,
    onBonePicked: (storeId: number | null) => emit('bone-picked', storeId),
  }
}

useCpmViewer(
  container,
  cpmData,
  activeLayers,
  useViewerControls(),
  activeAnimations,
  isAnimationPlaying,
  animationSpeed,
  isAnimationLooped,
  viewerOptions,
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
