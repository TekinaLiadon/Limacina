<script setup lang="ts">
import { MultiSelect, type DropdownOption } from '@/06-shared'
import ToolIconButton from './ToolIconButton.vue'

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
      :class="{ 'tool-icon-button--active': isLooped }"
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
    <span class="cpm-anim-bar__divider" aria-hidden="true" />
    <div class="cpm-anim-bar__speed">
      <ToolIconButton label="Замедлить анимацию" icon="minus" :disabled="!canSpeedDown" @click="emit('speed-down')" />
      <span class="cpm-anim-bar__speed-value">{{ speed.toFixed(2).replace(/\.?0+$/, '') }}×</span>
      <ToolIconButton label="Ускорить анимацию" icon="plus" :disabled="!canSpeedUp" @click="emit('speed-up')" />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
.cpm-anim-bar {
  @include mixins.tool-panel;

  display: flex;
  align-items: center;
  gap: var(--space-4);

  &__select {
    flex: 1;
    min-width: 0;
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

  @include mixins.slider-header('speed-value', $header: false);

  &__speed-value {
    min-width: var(--cpm-speed-value-min-width);
    text-align: center;
  }
}
</style>
