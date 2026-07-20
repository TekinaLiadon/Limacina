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
</script>

<template>
  <div class="launch-progress">
    <div class="launch-progress__header">
      <ProgressBar :progress="progress" />
    </div>

    <StepProgress :steps="steps" />

    <Button
        class="btn-yellow current-account__btn current-account__btn--secondary"
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
  gap: 32px;

  &__header {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__error {
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: 13px;
    word-break: break-word;
  }
}
</style>
