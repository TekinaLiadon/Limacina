<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
  step?: number
}>(), {
  step: 1,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const isPercent = computed((): boolean => props.min === 0 && props.max === 1)

const percent = computed((): number => {
  const raw = ((props.modelValue - props.min) / (props.max - props.min)) * 100
  return Math.min(100, Math.max(0, raw))
})

const displayValue = computed((): string =>
  isPercent.value ? `${Math.round(percent.value)}%` : String(props.modelValue),
)

const onInput = (e: Event): void => {
  const target = e.target as HTMLInputElement
  const value = Number(target.value)
  if (Number.isFinite(value)) emit('update:modelValue', value)
}
</script>

<template>
  <div class="game-slider-field">
    <div class="game-slider-field__header">
      <span class="game-slider-field__label">{{ label }}</span>
      <span class="game-slider-field__value">{{ displayValue }}</span>
    </div>
    <div class="game-slider-field__track">
      <div class="game-slider-field__fill" :style="{ width: `${percent}%` }" />
      <input
        type="range"
        class="game-slider-field__input"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @input="onInput"
      />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-slider-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  min-width: 0;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-12);
  }

  &__label {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
    text-align: left;
    white-space: nowrap;
  }

  &__value {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  &__track {
    @include mixins.slider-track;
  }

  &__fill {
    @include mixins.slider-fill;

    left: 0;
  }

  &__input {
    @include mixins.slider-input;
  }
}
</style>
