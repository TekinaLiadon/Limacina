<script setup lang="ts">
import { computed } from 'vue'
import CpmTabbedPanel from './CpmTabbedPanel.vue'
import type { CpmTabbedPanelData } from './cpmTabbedPanel'
import ToolIconButton from './ToolIconButton.vue'

const props = defineProps<{
  data: CpmTabbedPanelData
  modelValue: string[]
  hasAnimation: boolean
  isPlaying: boolean
  isLooped: boolean
  speed: number
  canSpeedDown: boolean
  canSpeedUp: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'toggle-play': []
  'toggle-loop': []
  'speed-down': []
  'speed-up': []
}>()

const speedLabel = computed((): string =>
  `${props.speed.toFixed(2).replace(/\.?0+$/, '')}×`,
)

const clearSelection = (): void => {
  emit('update:modelValue', [])
}
</script>

<template>
  <CpmTabbedPanel
    class="cpm-animation-panel"
    :data="data"
    :model-value="modelValue"
    title="Анимации"
    count-prefix="Выбрано"
    empty-data-label="В модели пока нет анимаций"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #actions>
      <div class="cpm-animation-panel__transport">
        <ToolIconButton
          :label="isPlaying ? 'Пауза' : 'Воспроизвести'"
          :disabled="!hasAnimation"
          @click="emit('toggle-play')"
        >
          <svg v-if="isPlaying" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </ToolIconButton>
        <ToolIconButton
          label="Повторять анимацию"
          :disabled="!hasAnimation"
          :aria-pressed="isLooped"
          @click="emit('toggle-loop')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
        </ToolIconButton>
        <span class="cpm-animation-panel__divider" aria-hidden="true" />
        <div class="cpm-animation-panel__speed">
          <ToolIconButton label="Замедлить анимацию" icon="minus" :disabled="!canSpeedDown" @click="emit('speed-down')" />
          <span class="cpm-animation-panel__speed-value">{{ speedLabel }}</span>
          <ToolIconButton label="Ускорить анимацию" icon="plus" :disabled="!canSpeedUp" @click="emit('speed-up')" />
        </div>
        <button
          class="cpm-animation-panel__clear"
          type="button"
          :disabled="modelValue.length === 0"
          @click="clearSelection"
        >
          Сбросить
        </button>
        <slot name="actions" />
      </div>
    </template>
  </CpmTabbedPanel>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-animation-panel {
  @include mixins.slider-header('speed-value', $header: false);

  &__transport {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  &__divider {
    @include mixins.tool-divider;
  }

  &__speed {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__speed-value {
    min-width: var(--cpm-speed-value-min-width);
    text-align: center;
  }

  &__clear {
    flex-shrink: 0;
    padding: var(--space-4) var(--space-8);
    border: none;
    border-radius: var(--radius-badge);
    background: transparent;
    color: var(--login-text-muted);
    font-family: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

    &:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__transport .tool-icon-button[aria-pressed="true"] {
    background: var(--accent-active-bg);
    color: var(--accent-text);
  }
}
</style>
