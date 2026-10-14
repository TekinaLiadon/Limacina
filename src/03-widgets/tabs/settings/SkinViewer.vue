<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useSkinViewer } from '@/04-features'
import { useViewerControls } from './viewerControls'

const props = withDefaults(defineProps<{
  skinUrl: string
  slim?: boolean
}>(), {
  slim: false,
})

const emit = defineEmits<{
  'load-error': []
}>()

const container = ref<HTMLDivElement | null>(null)

useSkinViewer(container, toRef(props, 'skinUrl'), useViewerControls(), toRef(props, 'slim'), {
  onTextureError: () => emit('load-error'),
})
</script>

<template>
  <div ref="container" class="skin-viewer__canvas" />
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.skin-viewer__canvas {
  @include mixins.viewer-canvas;
}
</style>
