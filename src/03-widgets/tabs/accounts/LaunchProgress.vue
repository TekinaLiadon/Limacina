<script setup lang="ts">
import { computed } from 'vue'
import {Button, ProgressBar} from '@/06-shared'
import { StepProgress } from '@/03-widgets'
import type { StepProgressItem } from '@/05-entities/core/types'

const props = defineProps<{
  progress: number
  steps: StepProgressItem[]
  error?: string
}>()

const isLaunchingGame = computed((): boolean => {
  const last = props.steps[props.steps.length - 1]
  return last?.status === 'active'
})

const headerLabel = computed((): string =>
  isLaunchingGame.value ? 'Запуск игры' : 'Подготовка запуска'
)

defineEmits<{
  'go-to-accounts': []
}>()

const canGoBack = (steps: StepProgressItem[]): boolean => {
  if (steps.length === 0) return true
  if (steps.some((step) => step.status === 'error')) return true

  const last = steps[steps.length - 1]
  return last.status === 'active' || last.status === 'done'
}
</script>

<template>
  <div class="launch-progress">
    <div class="launch-progress__header">
      <span class="launch-progress__label eyebrow">{{ headerLabel }}</span>
      <ProgressBar :progress="progress" />
    </div>

    <StepProgress :steps="steps" />

    <p v-if="isLaunchingGame" class="launch-progress__hint">
      Игра запускается — окно откроется автоматически
    </p>

    <Button
        class="btn-quiet btn-block launch-progress__btn"
        :is-disabled="!canGoBack(steps)"
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

  &__hint {
    margin: 0;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-muted);
  }

  &__btn {
    min-height: var(--control-height);
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
