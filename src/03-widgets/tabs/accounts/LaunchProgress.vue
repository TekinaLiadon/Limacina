<script setup lang="ts">
import {Button, ProgressBar} from '@/06-shared'
import { StepProgress } from '@/03-widgets'
import type { StepProgressItem } from '@/05-entities/core/types'

defineProps<{
  progress: number
  steps: StepProgressItem[]
  error?: string
}>()

defineEmits<{
  'go-to-accounts': []
}>()

const isLaunchStep = (steps: StepProgressItem[]): boolean => {
  if (steps.length === 0) return false

  const last = steps[steps.length - 1]
  return last.status === 'active' || last.status === 'done' || last.status === 'error'
}
</script>

<template>
  <div class="launch-progress">
    <div class="launch-progress__header">
      <span class="launch-progress__label eyebrow">Подготовка запуска</span>
      <ProgressBar :progress="progress" />
    </div>

    <StepProgress :steps="steps" />

    <Button
        class="btn-quiet btn-block launch-progress__btn"
        :is-disabled="!isLaunchStep(steps)"
        @click="$emit('go-to-accounts')"
    >
      Выбрать другой
    </Button>

    <div v-if="error" class="launch-progress__error">
      {{ error }}
    </div>
  </div>
</template>

<style lang="scss">
.launch-progress {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-24);

  &__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__btn {
    min-height: 44px;
  }

  &__error {
    padding: var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    color: var(--error);
    font-size: var(--text-body-sm);
    text-align: left;
    word-break: break-word;
  }
}
</style>
