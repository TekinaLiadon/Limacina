<script setup lang="ts">
import { computed } from 'vue'
import {Button, ProgressBar} from '@/06-shared'
import { StepProgress } from '@/03-widgets'
import type { StepProgressItem } from '@/05-entities/core/types'

const props = defineProps<{
  progress: number
  steps: StepProgressItem[]
  error?: string
  isCancelPending?: boolean
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
        :is-disabled="isCancelPending ?? false"
        @click="$emit('go-to-accounts')"
    >
      {{ isCancelPending ? 'Завершаем текущий шаг…' : 'Выбрать другой' }}
    </Button>

    <div v-if="error" class="launch-progress__error">
      {{ error }}
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
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
    @include mixins.error-box;
  }
}
</style>
