<script setup lang="ts">
import { computed, ref } from 'vue'
import { PopupShell } from '@/06-shared'
import { DEFAULT_VIEWER_MIN_ZOOM, provideViewerControls } from './viewerControls'
import ViewerToolbar from './ViewerToolbar.vue'

const props = withDefaults(defineProps<{
  minZoom?: number
  workspace?: boolean
  fullscreenLabel?: string
}>(), {
  minZoom: DEFAULT_VIEWER_MIN_ZOOM,
  workspace: false,
  fullscreenLabel: 'Просмотр 3D-модели',
})

provideViewerControls((): number => props.minZoom)

const isFullscreen = defineModel<boolean>('fullscreen', { default: false })

const stageTarget = ref<HTMLDivElement | null>(null)
const bottomTarget = ref<HTMLDivElement | null>(null)

const panelClass = computed((): string =>
  props.workspace
    ? 'viewer-3d-fullscreen__content viewer-3d-fullscreen__content--workspace'
    : 'viewer-3d-fullscreen__content',
)

const openFullscreen = (): void => {
  isFullscreen.value = true
}

const closeFullscreen = (): void => {
  isFullscreen.value = false
}
</script>

<template>
  <PopupShell
    :visible="isFullscreen"
    persistent
    :aria-label="fullscreenLabel"
    :panel-class="panelClass"
    overlay-class="viewer-3d-fullscreen__overlay"
    @close="closeFullscreen"
  >
    <div v-if="workspace && $slots.head" class="viewer-3d-fullscreen__head">
      <slot name="head" />
    </div>
    <div class="viewer-3d-fullscreen__body">
      <div class="viewer-3d-fullscreen__scene">
        <div ref="stageTarget" class="viewer-3d-fullscreen__stage" />
        <ViewerToolbar fullscreen @toggle-fullscreen="closeFullscreen" />
      </div>
      <div v-if="workspace && $slots.side" class="viewer-3d-fullscreen__side">
        <slot name="side" />
      </div>
    </div>
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

.viewer-3d-fullscreen__overlay {
  z-index: var(--z-viewer-fullscreen);
}

.viewer-3d-fullscreen__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: calc(100vw - var(--space-48));
  max-width: var(--viewer-fullscreen-max-width);
  height: calc(100vh - var(--space-48));

  &--workspace {
    max-width: var(--viewer-editor-max-width);
  }
}

.viewer-3d-fullscreen__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  flex: 1;
  min-height: 0;
}

.viewer-3d-fullscreen__scene {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  flex: 1;
  min-height: 0;
}

.viewer-3d-fullscreen__head,
.viewer-3d-fullscreen__bottom {
  flex-shrink: 0;
}

.viewer-3d-fullscreen__side {
  display: flex;
  flex-shrink: 0;
  min-height: 0;
}

.viewer-3d-fullscreen__content--workspace {
  .viewer-3d-fullscreen__body {
    flex-direction: row;
    align-items: stretch;
  }
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
