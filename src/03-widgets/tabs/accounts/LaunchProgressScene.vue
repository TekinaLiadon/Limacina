<script setup lang="ts">
import { computed } from 'vue'
import { Button, ProgressBar } from '@/06-shared'
import StepProgress from '@/03-widgets/tabs/login/StepProgress.vue'
import type { StepProgressItem } from '@/05-entities'

const props = defineProps<{
  progress: number
  steps: StepProgressItem[]
  isCancelPending: boolean
  isInterrupted: boolean
}>()

const emit = defineEmits<{
  cancel: []
}>()

const isLaunchingGame = computed((): boolean => {
  const last = props.steps[props.steps.length - 1]
  return last?.status === 'active'
})

const progressLabel = computed((): string =>
  isLaunchingGame.value ? 'Запуск игры' : 'Подготовка запуска',
)
</script>

<template>
  <div class="launch-scene__progress">
    <div class="launch-scene__progress-header">
      <span class="eyebrow">{{ progressLabel }}</span>
      <ProgressBar :progress="progress" />
    </div>

    <StepProgress :steps="steps" hide-completed />

    <p v-if="isInterrupted" class="launch-scene__hint">
      Запуск был прерван перезагрузкой окна — отмените и запустите заново
    </p>

    <p v-if="isLaunchingGame" class="launch-scene__hint">
      Игра запускается — окно откроется автоматически
    </p>

    <Button
      class="btn-quiet btn-block"
      :is-disabled="isCancelPending"
      @click="emit('cancel')"
    >
      {{ isCancelPending ? 'Завершаем текущий шаг…' : 'Отменить запуск' }}
    </Button>
  </div>
</template>

<style lang="scss">
.launch-scene {
  &__progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
  }

  &__progress-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
}
</style>
