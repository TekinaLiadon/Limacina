<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { provideViewerControls } from './viewerControls'
import ViewerToolbar from './ViewerToolbar.vue'

const props = withDefaults(defineProps<{
  minZoom?: number
  maxZoom?: number
}>(), {
  minZoom: 5,
  maxZoom: 30,
})

provideViewerControls(props.minZoom, props.maxZoom)

const isFullscreen = ref<boolean>(false)

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
  <div class="viewer-3d">
    <div class="viewer-3d__stage">
      <slot />
    </div>
    <ViewerToolbar @toggle-fullscreen="openFullscreen" />
  </div>

  <Teleport to="body">
    <Transition name="viewer-fullscreen">
      <div v-if="isFullscreen" class="viewer-3d-fullscreen" @click.self="closeFullscreen">
        <div class="viewer-3d-fullscreen__content">
          <div class="viewer-3d-fullscreen__stage">
            <slot />
          </div>
          <ViewerToolbar fullscreen @toggle-fullscreen="closeFullscreen" />
        </div>
      </div>
    </Transition>
  </Teleport>
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

.viewer-3d-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);

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

.viewer-fullscreen-enter-active,
.viewer-fullscreen-leave-active {
  transition: opacity 0.2s ease;
}

.viewer-fullscreen-enter-from,
.viewer-fullscreen-leave-to {
  opacity: 0;
}
</style>
