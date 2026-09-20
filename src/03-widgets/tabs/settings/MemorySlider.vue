<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: [number, number]
  max: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: [number, number]]
}>()

const min = 512
const step = 512
const fallbackMax = 8192

const clampToRange = (v: number, minVal: number, maxVal: number, fallback: number): number => {
  if (!Number.isFinite(v)) return fallback
  return Math.min(Math.max(v, minVal), maxVal)
}

const minVal = computed({
  get: () => props.modelValue[0],
  set: (v: number) => {
    const clamped = clampToRange(v, min, maxLimit.value, fallbackMin)
    if (clamped > props.modelValue[1]) {
      emit('update:modelValue', [clamped, clamped])
      return
    }
    emit('update:modelValue', [clamped, props.modelValue[1]])
  },
})

const maxVal = computed({
  get: () => props.modelValue[1],
  set: (v: number) => {
    const clamped = clampToRange(v, min, maxLimit.value, fallbackMax)
    if (clamped < props.modelValue[0]) {
      emit('update:modelValue', [clamped, clamped])
      return
    }
    emit('update:modelValue', [props.modelValue[0], clamped])
  },
})

const formatValue = (val: number): string => {
  if (val >= 1024) {
    return `${(val / 1024).toFixed(val % 1024 === 0 ? 0 : 1)}G`
  }
  return `${val}M`
}

const minPercent = computed((): number => {
  return ((minVal.value - min) / (maxLimit.value - min)) * 100
})

const maxPercent = computed((): number => {
  return ((maxVal.value - min) / (maxLimit.value - min)) * 100
})

const maxLimit = computed((): number => {
  return Math.max(props.max, min + step * 2)
})

const fallbackMin = 512

const onMinInput = (e: Event): void => {
  const target = e.target as HTMLInputElement
  minVal.value = Number(target.value)
}

const onMaxInput = (e: Event): void => {
  const target = e.target as HTMLInputElement
  maxVal.value = Number(target.value)
}
</script>

<template>
  <div class="memory-slider">
    <div class="memory-slider__header">
      <label class="memory-slider__label eyebrow">Память (min — max)</label>
      <span class="memory-slider__values">
        {{ formatValue(minVal) }} — {{ formatValue(maxVal) }}
      </span>
    </div>
    <div class="memory-slider__track">
      <div
        class="memory-slider__fill"
        :style="{
          left: `${minPercent}%`,
          width: `${maxPercent - minPercent}%`,
        }"
      />
      <input
        type="range"
        class="memory-slider__input memory-slider__input--min"
        :min="min"
        :max="maxLimit"
        :step="step"
        :value="minVal"
        @input="onMinInput"
      />
      <input
        type="range"
        class="memory-slider__input memory-slider__input--max"
        :min="min"
        :max="maxLimit"
        :step="step"
        :value="maxVal"
        @input="onMaxInput"
      />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.memory-slider {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-12);
  }

  &__values {
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
    font-variant-numeric: tabular-nums;
  }

  &__track {
    @include mixins.slider-track;
  }

  &__fill {
    @include mixins.slider-fill;
  }

  &__input {
    @include mixins.slider-input;

    z-index: var(--z-content);
    pointer-events: none;
  }
}
</style>
