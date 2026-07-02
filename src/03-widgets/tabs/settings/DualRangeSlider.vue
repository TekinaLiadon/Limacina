<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: [number, number]
  min: number
  max: number
  step: number
  label: string
  unit: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: [number, number]]
}>()

const minVal = computed({
  get: () => props.modelValue[0],
  set: (v: number) => {
    const clamped = Math.min(v, props.modelValue[1] - props.step)
    emit('update:modelValue', [clamped, props.modelValue[1]])
  },
})

const maxVal = computed({
  get: () => props.modelValue[1],
  set: (v: number) => {
    const clamped = Math.max(v, props.modelValue[0] + props.step)
    emit('update:modelValue', [props.modelValue[0], clamped])
  },
})

const formatValue = (val: number): string => {
  if (val >= 1024) {
    return `${(val / 1024).toFixed(val % 1024 === 0 ? 0 : 1)}G`
  }
  return `${val}${props.unit}`
}

const minPercent = computed((): number => {
  return ((minVal.value - props.min) / (props.max - props.min)) * 100
})

const maxPercent = computed((): number => {
  return ((maxVal.value - props.min) / (props.max - props.min)) * 100
})

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
  <div class="dual-range" :class="{ 'dual-range--disabled': disabled }">
    <div class="dual-range__header">
      <label class="dual-range__label">{{ label }}</label>
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
        :max="max"
        :step="step"
        :value="minVal"
        :disabled="disabled"
        @input="onMinInput"
      />
      <input
        type="range"
        class="dual-range__input dual-range__input--max"
        :min="min"
        :max="max"
        :step="step"
        :value="maxVal"
        :disabled="disabled"
        @input="onMaxInput"
      />
    </div>
  </div>
</template>

<style lang="scss">
.dual-range {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  &__label {
    font-size: 13px;
    color: var(--login-text-secondary);
  }

  &__values {
    font-size: 14px;
    font-weight: 600;
    color: var(--login-text-primary);
    font-variant-numeric: tabular-nums;
  }

  &__track {
    position: relative;
    height: 6px;
    background: var(--grey-stroke);
    border-radius: 3px;
  }

  &__fill {
    position: absolute;
    top: 0;
    height: 100%;
    background: linear-gradient(90deg, var(--login-accent), var(--login-accent-hover));
    border-radius: 3px;
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
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--login-accent);
      border: 2px solid var(--white);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.15s ease;

      &:hover {
        transform: scale(1.15);
      }
    }

    &::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--login-accent);
      border: 2px solid var(--white);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      pointer-events: auto;
    }
  }
}
</style>
