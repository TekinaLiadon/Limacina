<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { provideViewerControls } from './viewerControls'
import ViewerStage from './ViewerStage.vue'
import ViewerToolbar from './ViewerToolbar.vue'

const props = withDefaults(defineProps<{
  minZoom?: number
}>(), {
  minZoom: 5,
})

provideViewerControls(props.minZoom)

const isFullscreen = ref<boolean>(false)
const stageTarget = ref<HTMLDivElement | null>(null)
const bottomTarget = ref<HTMLDivElement | null>(null)

const openFullscreen = (): void => {
  isFullscreen.value = true
}

const closeFullscreen = (): void => {
  isFullscreen.value = false
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') closeFullscreen()
}

watch(isFullscreen, (open: boolean) => {
  if (open) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popup">
      <div v-show="isFullscreen" class="viewer-3d-fullscreen" @click.self="closeFullscreen">
        <div class="viewer-3d-fullscreen__content popup-panel">
          <div ref="stageTarget" class="viewer-3d-fullscreen__stage" />
          <ViewerToolbar fullscreen @toggle-fullscreen="closeFullscreen" />
          <div ref="bottomTarget" class="viewer-3d-fullscreen__bottom" />
        </div>
      </div>
    </Transition>
  </Teleport>

  <div class="viewer-3d">
    <div class="viewer-3d__stage">
      <Teleport :to="stageTarget" :disabled="!isFullscreen">
        <ViewerStage>
          <slot />
        </ViewerStage>
      </Teleport>
    </div>
    <ViewerToolbar @toggle-fullscreen="openFullscreen" />
    <Teleport :to="bottomTarget" :disabled="!isFullscreen">
      <slot name="bottom" />
    </Teleport>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.viewer-3d {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  &__stage {
    width: 100%;
  }
}

.viewer-3d-fullscreen {
  @include mixins.popup-overlay;

  &__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    width: calc(100vw - var(--space-48));
    max-width: 1100px;
    height: calc(100vh - var(--space-48));
  }

  &__stage {
    flex: 1;
    min-height: 0;

    .skin-viewer__canvas,
    .cpm-viewer__canvas {
      height: 100%;
    }
  }
}
</style>
