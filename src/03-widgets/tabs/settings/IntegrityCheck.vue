<script setup lang="ts">
import { computed } from 'vue'
import { Button, ProgressBar } from '@/06-shared'
import { StepProgress } from '@/03-widgets'
import type { IntegrityReport, StepProgressItem } from '@/05-entities'

const props = defineProps<{
  isChecking: boolean
  isPopupHidden: boolean
  steps: StepProgressItem[]
  progress: number
  report: IntegrityReport | null
  errorMessage: string
}>()

const emit = defineEmits<{
  check: []
  close: []
}>()

const hasErrors = computed((): boolean => props.report !== null && props.report.failed.length > 0)
const isClean = computed((): boolean => props.report !== null && props.report.failed.length === 0)

const resultText = computed((): string => {
  const {report} = props
  if (report === null) return ''
  const parts: string[] = [`проверено: ${report.total}`]
  if (report.broken > 0) parts.push(`повреждено: ${report.broken}`)
  if (report.missing > 0) parts.push(`отсутствовало: ${report.missing}`)
  if (report.repaired > 0) parts.push(`восстановлено: ${report.repaired}`)
  return parts.join(', ')
})

const isCheckingNow = computed((): boolean => props.isChecking || props.steps.some((s) => s.status === 'active'))
</script>

<template>
  <div class="integrity-check">
    <span class="integrity-check__text">Целостность файлов</span>
    <Button class="btn-secondary integrity-check__btn" :is-disabled="isChecking" :is-loading="isChecking" @click="emit('check')">
      Проверить
    </Button>

    <Teleport to="body">
      <Transition name="popup">
        <div v-if="!isPopupHidden && (isChecking || report !== null || errorMessage)" class="integrity-popup-overlay" @click.self="emit('close')">
          <div class="integrity-popup popup-panel">
            <h3 class="integrity-popup__title">Проверка целостности файлов</h3>

            <template v-if="isCheckingNow">
              <div class="integrity-popup__progress">
                <ProgressBar :progress="progress" />
              </div>
              <div class="integrity-popup__steps">
                <StepProgress :steps="steps" />
              </div>
            </template>

            <template v-else-if="errorMessage">
              <div class="integrity-popup__error">{{ errorMessage }}</div>
            </template>

            <template v-else>
              <div v-if="isClean" class="integrity-popup__summary integrity-popup__summary--ok">
                Все файлы в порядке
              </div>
              <div v-else-if="hasErrors" class="integrity-popup__summary integrity-popup__summary--error">
                Не удалось восстановить {{ report?.failed.length }} файлов
              </div>
              <div v-else class="integrity-popup__summary">
                Файлы восстановлены
              </div>
              <p class="integrity-popup__stats">{{ resultText }}</p>
              <ul v-if="hasErrors" class="integrity-popup__failed">
                <li v-for="file in report?.failed" :key="file">{{ file }}</li>
              </ul>
            </template>

            <div class="integrity-popup__actions">
              <Button
                class="btn-primary integrity-popup__btn"
                :is-disabled="isCheckingNow"
                @click="emit('check')"
              >
                Проверить снова
              </Button>
              <Button class="btn-quiet integrity-popup__btn" @click="emit('close')">
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
.integrity-check {
  @include mixins.settings-row-body;
}

.integrity-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-popup);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.integrity-popup {
  background: var(--login-bg-form);
  border-radius: var(--radius-modal);
  padding: var(--card-padding);
  box-shadow: var(--elevation-modal);
  max-width: 400px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-20);

  &__title {
    font-family: var(--font-display);
    font-size: var(--text-subheading);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-heading);
    color: var(--login-text-primary);
    margin: 0;
    text-align: center;
  }

  &__steps {
    max-height: 40vh;
    overflow-y: auto;
  }

  &__summary {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    text-align: center;

    &--ok {
      color: var(--login-text-primary);
    }

    &--error {
      color: var(--error);
    }
  }

  &__stats {
    margin: 0;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
    text-align: center;
  }

  &__error {
    @include mixins.error-box;
  }

  &__failed {
    margin: 0;
    padding: 0 0 0 var(--space-16);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    word-break: break-all;
  }

  &__actions {
    display: flex;
    gap: var(--space-8);
  }

  &__btn {
    flex: 1;
    min-height: var(--control-height);
  }
}
</style>
