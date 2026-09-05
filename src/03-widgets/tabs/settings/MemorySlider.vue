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
    const clamped = clampToRange(v, min, minValMax(), fallbackMin)
    emit('update:modelValue', [clamped, props.modelValue[1]])
  },
})

const maxVal = computed({
  get: () => props.modelValue[1],
  set: (v: number) => {
    const clamped = clampToRange(v, props.modelValue[0] + step, props.max, fallbackMax)
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

const minValMax = (): number => {
  return Math.max(props.modelValue[1] - step, min + step)
}

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
  <div class="dual-range">
    <div class="dual-range__header">
      <label class="dual-range__label eyebrow">Память (min — max)</label>
      <span class="dual-range__values">
        {{ formatValue(minVal) }} — {{ formatValue(maxVal) }}
      </span>
    </div>
    <div class="dual-range__track">
      <div
        class="dual-range__fill"
        :style="{
          left: `${minPercent}%`,
          width: `${maxPercent - minPercent}%`,
        }"
      />
      <input
        type="range"
        class="dual-range__input dual-range__input--min"
        :min="min"
        :max="maxLimit"
        :step="step"
        :value="minVal"
        @input="onMinInput"
      />
      <input
        type="range"
        class="dual-range__input dual-range__input--max"
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
.dual-range {
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
    position: relative;
    height: 6px;
    background: var(--surface-active);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-pill);
  }

  &__fill {
    position: absolute;
    top: 0;
    height: 100%;
    background: linear-gradient(90deg, var(--login-accent), var(--login-accent-hover));
    border-radius: var(--radius-pill);
    pointer-events: none;
  }

  &__input {
    position: absolute;
    top: -7px;
    left: 0;
    width: 100%;
    height: 20px;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
    z-index: 1;
    pointer-events: none;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border-radius: var(--radius-circle);
      background: var(--login-accent);
      border: none;
      box-shadow: var(--elevation-glow), inset 0 0 0 1px var(--border-subtle);
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.15s ease;

      &:hover {
        transform: scale(1.15);
      }
    }

    &::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: var(--radius-circle);
      background: var(--login-accent);
      border: none;
      box-shadow: var(--elevation-glow), inset 0 0 0 1px var(--border-subtle);
      cursor: pointer;
      pointer-events: auto;
    }
  }
}
</style>
