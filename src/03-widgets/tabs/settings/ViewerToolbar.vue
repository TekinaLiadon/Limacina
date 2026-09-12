<script setup lang="ts">
import { computed } from 'vue'
import { ELEVATION_MAX, ELEVATION_MIN, MIN_ZOOM_PERCENT, useViewerControls } from './viewerControls'

defineProps<{
  fullscreen?: boolean
}>()

const emit = defineEmits<{
  'toggle-fullscreen': []
}>()

const controls = useViewerControls()

const zoomPercent = computed((): number =>
  Math.round((controls.fitDistance.value / controls.zoomLevel.value) * 100)
)

const canZoomIn = computed((): boolean => controls.zoomLevel.value > controls.minZoom)
const canZoomOut = computed((): boolean => zoomPercent.value > MIN_ZOOM_PERCENT)
const canRotateUp = computed((): boolean => controls.rotationX.value < ELEVATION_MAX)
const canRotateDown = computed((): boolean => controls.rotationX.value > ELEVATION_MIN)

const toggleAutoRotate = (): void => {
  controls.autoRotate.value = !controls.autoRotate.value
}
</script>

<template>
  <div class="viewer-toolbar" role="toolbar" aria-label="Управление просмотром">
    <button
      class="viewer-toolbar__btn"
      :disabled="!canZoomIn"
      aria-label="Приблизить"
      @click="controls.zoomIn"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    <button
      class="viewer-toolbar__btn viewer-toolbar__btn--percent"
      aria-label="Сбросить масштаб"
      @click="controls.resetZoom"
    >
      {{ zoomPercent }}%
    </button>

    <button
      class="viewer-toolbar__btn"
      :disabled="!canZoomOut"
      aria-label="Отдалить"
      @click="controls.zoomOut"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    <span class="viewer-toolbar__divider" aria-hidden="true" />

    <button
      class="viewer-toolbar__btn"
      aria-label="Повернуть влево"
      @click="controls.rotateLeft"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    </button>

    <button
      class="viewer-toolbar__btn"
      aria-label="Повернуть вправо"
      @click="controls.rotateRight"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    </button>

    <button
      class="viewer-toolbar__btn"
      :disabled="!canRotateUp"
      aria-label="Повернуть вверх"
      @click="controls.rotateUp"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </button>

    <button
      class="viewer-toolbar__btn"
      :disabled="!canRotateDown"
      aria-label="Повернуть вниз"
      @click="controls.rotateDown"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <span class="viewer-toolbar__divider" aria-hidden="true" />

    <button
      class="viewer-toolbar__btn"
      :class="{ 'viewer-toolbar__btn--active': controls.autoRotate.value }"
      :aria-pressed="controls.autoRotate.value"
      aria-label="Автоповорот"
      @click="toggleAutoRotate"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>

    <button
      class="viewer-toolbar__btn"
      aria-label="Сбросить вид"
      @click="controls.resetView"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="22" y1="12" x2="18" y2="12" />
        <line x1="6" y1="12" x2="2" y2="12" />
        <line x1="12" y1="6" x2="12" y2="2" />
        <line x1="12" y1="22" x2="12" y2="18" />
      </svg>
    </button>

    <span class="viewer-toolbar__divider" aria-hidden="true" />

    <button
      class="viewer-toolbar__btn"
      :aria-label="fullscreen ? 'Свернуть просмотр' : 'Развернуть на весь экран'"
      @click="emit('toggle-fullscreen')"
    >
      <svg v-if="fullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
        <line x1="14" y1="10" x2="21" y2="3" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  </div>
</template>

<style lang="scss">
.viewer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--surface-subtle);
  box-shadow: var(--elevation-inset);
  border-radius: var(--radius-card);

  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    border: none;
    border-radius: var(--radius-button);
    background: transparent;
    color: var(--login-text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-caption);
    transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;

    &:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &--active {
      background: var(--accent-active-bg);
      color: var(--accent-text);
      box-shadow: var(--elevation-inset);
    }

    &--percent {
      width: auto;
      min-width: 56px;
      padding: 0 var(--space-8);
      font-family: var(--font-mono);
      font-weight: var(--weight-medium);
      color: var(--login-text-primary);
      font-variant-numeric: tabular-nums;
    }
  }

  &__divider {
    width: 1px;
    height: var(--control-height-sm);
    background: var(--grid-line);
    flex-shrink: 0;
  }
}
</style>
