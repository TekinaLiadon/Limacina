<script setup lang="ts">
import { ref, toRef } from 'vue'
import { PopupShell } from '@/06-shared'
import { useFiguraViewer, type FiguraViewerSource } from '@/04-features'
import { useViewerControls } from '../viewerControls'
import ToolIconButton from '../ToolIconButton.vue'

const props = withDefaults(defineProps<{
  source: FiguraViewerSource | null
  ariaLabel?: string
}>(), {
  ariaLabel: 'Просмотр аватара Figura',
})

const emit = defineEmits<{
  'texture-error': []
}>()

const container = ref<HTMLDivElement | null>(null)
const stageTarget = ref<HTMLDivElement | null>(null)
const isFullscreen = ref<boolean>(false)

useFiguraViewer(container, toRef(props, 'source'), useViewerControls(), {
  enableZoom: true,
  onTextureError: (): void => {
    emit('texture-error')
  },
})

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
    :aria-label="ariaLabel"
    panel-class="figura-viewer__fullscreen-content"
    overlay-class="figura-viewer__fullscreen-overlay"
    @close="closeFullscreen"
  >
    <div class="figura-viewer__fullscreen-body">
      <div class="figura-viewer__fullscreen-scene">
        <div ref="stageTarget" class="figura-viewer__fullscreen-stage" />
        <div class="figura-viewer__actions">
          <ToolIconButton label="Свернуть просмотр" @click="closeFullscreen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </ToolIconButton>
        </div>
      </div>
    </div>
  </PopupShell>

  <div class="figura-viewer">
    <div class="figura-viewer__stage">
      <Teleport :to="stageTarget" :disabled="!isFullscreen">
        <div
          ref="container"
          class="figura-viewer__canvas"
          role="img"
          :aria-label="ariaLabel"
        />
      </Teleport>
      <p v-if="$slots.empty" class="figura-viewer__empty">
        <slot name="empty" />
      </p>
    </div>
    <div class="figura-viewer__actions">
      <ToolIconButton label="Развернуть на весь экран" @click="openFullscreen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </ToolIconButton>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.figura-viewer {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  &__stage {
    position: relative;
    width: 100%;
  }

  &__empty {
    @include mixins.caption-hint;

    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-16);
    pointer-events: none;
  }

  &__canvas {
    @include mixins.viewer-canvas;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
  }

  &__fullscreen-overlay {
    z-index: var(--z-viewer-fullscreen);
  }

  &__fullscreen-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    width: calc(100vw - var(--space-48));
    max-width: var(--viewer-fullscreen-max-width);
    height: calc(100vh - var(--space-48));
  }

  &__fullscreen-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    flex: 1;
    min-height: 0;
  }

  &__fullscreen-scene {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  &__fullscreen-stage {
    flex: 1;
    min-height: 0;

    .figura-viewer__canvas {
      height: 100%;
    }
  }
}
</style>
