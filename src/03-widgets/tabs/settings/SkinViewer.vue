<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useSkinViewer } from '@/04-features'

const props = defineProps<{
  skinUrl: string
}>()

const container = ref<HTMLDivElement | null>(null)

const skinUrl = shallowRef(props.skinUrl)
watch(() => props.skinUrl, (url: string) => { skinUrl.value = url })

useSkinViewer(container, skinUrl)
</script>

<template>
  <div ref="container" class="skin-viewer" />
</template>

<style lang="scss">
.skin-viewer {
  width: 100%;
  height: 360px;
  border-radius: 12px;
  overflow: hidden;
  background: #1a1d2e;

  canvas {
    display: block;
  }
}
</style>
