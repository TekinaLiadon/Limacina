<script setup lang="ts">
import { MultiSelect } from '@/06-shared'
import type { DropdownOption } from '@/06-shared/types'

defineProps<{
  options: DropdownOption[]
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
</script>

<template>
  <div class="cpm-anim-bar">
    <MultiSelect
      class="cpm-anim-bar__select"
      :options="options"
      :model-value="modelValue"
      placeholder="Анимации не выбраны"
      clearable
      width="100%"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <button
      class="cpm-anim-bar__btn"
      :disabled="!hasAnimation"
      :aria-label="isPlaying ? 'Пауза' : 'Воспроизвести'"
      @click="emit('toggle-play')"
    >
      <svg v-if="isPlaying" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    </button>
    <button
      class="cpm-anim-bar__btn"
      :class="{ 'cpm-anim-bar__btn--active': isLooped }"
      :disabled="!hasAnimation"
      :aria-pressed="isLooped"
      aria-label="Повторять анимацию"
      @click="emit('toggle-loop')"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    </button>
    <span class="cpm-anim-bar__divider" aria-hidden="true" />
    <div class="cpm-anim-bar__speed">
      <button
        class="cpm-anim-bar__btn"
        :disabled="!canSpeedDown"
        aria-label="Замедлить анимацию"
        @click="emit('speed-down')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <span class="cpm-anim-bar__speed-value">{{ speed.toFixed(2).replace(/\.?0+$/, '') }}×</span>
      <button
        class="cpm-anim-bar__btn"
        :disabled="!canSpeedUp"
        aria-label="Ускорить анимацию"
        @click="emit('speed-up')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.cpm-anim-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--surface-subtle);
  box-shadow: var(--elevation-inset);
  border-radius: var(--radius-card);

  &__select {
    flex: 1;
    min-width: 0;
  }

  &__divider {
    width: 1px;
    height: var(--control-height-sm);
    background: var(--grid-line);
    flex-shrink: 0;
  }

  &__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    flex-shrink: 0;
    border: none;
    border-radius: var(--radius-button);
    background: transparent;
    color: var(--login-text-secondary);
    cursor: pointer;
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
  }

  &__speed {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__speed-value {
    min-width: 44px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
    font-variant-numeric: tabular-nums;
  }
}
</style>
