<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import anime from 'animejs'
import type { StepProgressItem } from '@/05-entities/core/types'

const props = defineProps<{
  steps: StepProgressItem[]
}>()

const activeRef = ref<HTMLDivElement | null>(null)

watch(() => props.steps.map(s => `${s.status}:${s.current}:${s.detail}`).join(','), () => {
  if (activeRef.value) {
    anime({
      targets: activeRef.value.querySelector('.step-progress__indicator'),
      scale: [1, 1.3, 1],
      duration: 600,
      easing: 'easeInOutQuad',
    })
  }
})

const visibleSteps = computed((): StepProgressItem[] => {
  const hasError = props.steps.some((s) => s.status === 'error')
  if (hasError) return props.steps
  const firstActive = props.steps.findIndex((s) => s.status === 'active')
  if (firstActive === -1) return props.steps
  return props.steps.slice(firstActive)
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

const hasCounter = (step: StepProgressItem): boolean =>
  step.status === 'active' && step.total > 0

const counterText = (step: StepProgressItem): string => `${step.current}/${step.total}`

const subLabel = (step: StepProgressItem): string => {
  if (step.status === 'error' && step.error) return step.error
  if (step.status === 'done' && step.skipped) return 'Уже установлено'
  if (step.status === 'active' && step.detail) return step.detail
  return ''
}
</script>

<template>
  <div class="step-progress">
    <TransitionGroup name="step-progress-fade">
      <div
        v-for="step in visibleSteps"
        :key="step.key"
        :ref="el => { if (step.status === 'active') activeRef = el as HTMLDivElement }"
        class="step-progress__item"
        :class="`step-progress__item--${step.status}`"
      >
        <div class="step-progress__indicator" :class="getIndicatorClass(step.status)">
          {{ getIcon(step.status) }}
        </div>
        <div class="step-progress__content">
          <span class="step-progress__label">
            {{ step.label }}
            <span v-if="hasCounter(step)" class="step-progress__counter">{{ counterText(step) }}</span>
          </span>
          <span v-if="subLabel(step)" class="step-progress__sublabel">{{ subLabel(step) }}</span>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style lang="scss">
.step-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  position: relative;

  &__item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-12);
    opacity: 0.5;
    transition: opacity 0.3s ease;

    &--active,
    &--done,
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

    &--active {
      background: var(--login-accent);
      color: var(--text-on-accent);
      box-shadow: 0 0 0 4px var(--accent-active-bg);
    }

    &--pending {
      box-shadow: var(--elevation-inset);
      color: var(--login-text-muted);
    }

    &--done {
      background: var(--accent-active-bg);
      box-shadow: var(--elevation-inset);
      color: var(--accent-text);
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
    min-width: 0;
  }

  &__label {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
  }

  &__counter {
    font-variant-numeric: tabular-nums;
    color: var(--login-text-primary);
    margin-left: var(--space-8);
  }

  &__sublabel {
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--login-text-muted);
    word-break: break-word;
  }

  &__item--active &__label,
  &__item--done &__label {
    color: var(--login-text-primary);
  }

  &__item--error &__sublabel {
    color: var(--error);
  }

  &__item--done &__counter {
    display: none;
  }
}

.step-progress-fade-move,
.step-progress-fade-enter-active,
.step-progress-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.step-progress-fade-enter-from {
  opacity: 0;
  transform: translateX(var(--space-24));
}

.step-progress-fade-leave-to {
  opacity: 0;
  transform: translateX(calc(-1 * var(--space-48)));
}

.step-progress-fade-leave-active {
  position: absolute;
}
</style>
