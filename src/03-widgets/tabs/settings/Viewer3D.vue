<script setup lang="ts">
import { ref } from 'vue'
import { PopupShell } from '@/06-shared'
import { DEFAULT_VIEWER_MIN_ZOOM, provideViewerControls } from './viewerControls'
import ViewerToolbar from './ViewerToolbar.vue'

const props = withDefaults(defineProps<{
  minZoom?: number
}>(), {
  minZoom: DEFAULT_VIEWER_MIN_ZOOM,
})

provideViewerControls((): number => props.minZoom)

const isFullscreen = ref<boolean>(false)
const stageTarget = ref<HTMLDivElement | null>(null)
const bottomTarget = ref<HTMLDivElement | null>(null)

const openFullscreen = (): void => {
  isFullscreen.value = true
}

const closeFullscreen = (): void => {
  isFullscreen.value = false
}
</script>

<template>
  <PopupShell :visible="isFullscreen" persistent aria-label="Просмотр 3D-модели" panel-class="viewer-3d-fullscreen__content" @close="closeFullscreen">
    <div ref="stageTarget" class="viewer-3d-fullscreen__stage" />
    <ViewerToolbar fullscreen @toggle-fullscreen="closeFullscreen" />
    <div ref="bottomTarget" class="viewer-3d-fullscreen__bottom" />
  </PopupShell>

  <div class="viewer-3d">
    <div class="viewer-3d__stage">
      <Teleport :to="stageTarget" :disabled="!isFullscreen">
        <slot />
      </Teleport>
    </div>
    <ViewerToolbar @toggle-fullscreen="openFullscreen" />
    <Teleport :to="bottomTarget" :disabled="!isFullscreen">
      <slot name="bottom" />
    </Teleport>
  </div>
</template>

<style lang="scss">
.viewer-3d {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  &__stage {
    width: 100%;
  }
}

.viewer-3d-fullscreen__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: calc(100vw - var(--space-48));
  max-width: var(--viewer-fullscreen-max-width);
  height: calc(100vh - var(--space-48));
}

.viewer-3d-fullscreen__stage {
  flex: 1;
  min-height: 0;

  .skin-viewer__canvas,
  .cpm-viewer__canvas {
    height: 100%;
  }
}
</style>
