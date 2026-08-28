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
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.step-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
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
    width: 24px;
    height: 24px;
    border-radius: var(--radius-circle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    flex-shrink: 0;
    transition: background-color 0.3s ease, box-shadow 0.3s ease;

    &--pending {
      background: var(--surface-active);
      box-shadow: var(--elevation-inset);
      color: var(--login-text-muted);
    }

    &--active {
      background: var(--login-accent);
      color: var(--text-on-accent);
      box-shadow: 0 0 0 4px var(--accent-active-bg);
    }

    &--done {
      background: var(--accent-active-bg);
      box-shadow: var(--elevation-inset);
      color: var(--login-accent);
    }

    &--error {
      background: var(--error-bg);
      box-shadow: inset 0 0 0 1px var(--error-border);
      color: var(--error);
    }
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    text-align: left;
  }

  &__label {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
  }

  &__error {
    font-size: var(--text-caption);
    color: var(--error);
  }

  &__item--active &__label,
  &__item--done &__label {
    color: var(--login-text-primary);
  }
}
</style>
