<script setup lang="ts">
import { ref, shallowRef, toRef, watch } from 'vue'
import { useSkinViewer } from '@/04-features'
import { useViewerControls } from './viewerControls'

const props = withDefaults(defineProps<{
  skinUrl: string
  slim?: boolean
}>(), {
  slim: false,
})

const container = ref<HTMLDivElement | null>(null)

const skinUrl = shallowRef(props.skinUrl)
watch(() => props.skinUrl, (url: string) => { skinUrl.value = url })

useSkinViewer(container, skinUrl, useViewerControls(), toRef(props, 'slim'))
</script>

<template>
  <div ref="container" class="skin-viewer__canvas" />
</template>

<style lang="scss">
.skin-viewer__canvas {
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
