<script setup lang="ts">
import { ref, watch } from 'vue'
import anime from 'animejs'
import type { StepProgressItem } from '@/05-entities/core/types'

const props = defineProps<{
  steps: StepProgressItem[]
}>()

const activeRef = ref<HTMLDivElement | null>(null)

watch(() => props.steps.map(s => s.status).join(','), () => {
  if (activeRef.value) {
    anime({
      targets: activeRef.value.querySelector('.step-progress__indicator'),
      scale: [1, 1.3, 1],
      duration: 600,
      easing: 'easeInOutQuad',
    })
  }
})

const getIndicatorClass = (status: StepProgressItem['status']): string => {
  const map: Record<StepProgressItem['status'], string> = {
    pending: 'step-progress__indicator--pending',
    active: 'step-progress__indicator--active',
    done: 'step-progress__indicator--done',
    error: 'step-progress__indicator--error',
  }
  return map[status]
}

const getIcon = (status: StepProgressItem['status']): string => {
  const map: Record<StepProgressItem['status'], string> = {
    pending: '○',
    active: '●',
    done: '✓',
    error: '✕',
  }
  return map[status]
}
</script>

<template>
  <div class="step-progress">
    <div
      v-for="step in steps"
      :key="step.id"
      :ref="el => { if (step.status === 'active') activeRef = el as HTMLDivElement }"
      class="step-progress__item"
      :class="`step-progress__item--${step.status}`"
    >
      <div class="step-progress__indicator" :class="getIndicatorClass(step.status)">
        {{ getIcon(step.status) }}
      </div>
      <div class="step-progress__content">
        <span class="step-progress__label">{{ step.label }}</span>
        <span v-if="step.error" class="step-progress__error">{{ step.error }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.step-progress {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    opacity: 0.5;
    transition: opacity 0.3s ease;

    &--active,
    &--done {
      opacity: 1;
    }

    &--error {
      opacity: 1;
    }
  }

  &__indicator {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    flex-shrink: 0;
    transition: all 0.3s ease;

    &--pending {
      background: var(--grey-stroke);
      color: var(--login-text-muted);
    }

    &--active {
      background: var(--login-accent);
      color: var(--white);
      box-shadow: 0 0 0 4px rgba(108, 127, 216, 0.2);
    }

    &--done {
      background: var(--green-2);
      color: var(--white);
    }

    &--error {
      background: var(--error);
      color: var(--white);
    }
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 3px;
  }

  &__label {
    font-size: 14px;
    color: var(--login-text-primary);
  }

  &__error {
    font-size: 12px;
    color: var(--error);
  }
}
</style>
