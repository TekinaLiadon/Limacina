<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { getErrorMessage, initializeLauncher } from '@/06-shared/api'
import { Button, Input, joinPath } from '@/06-shared'
import { AddProfileTab } from '@/03-widgets'
import { open } from '@tauri-apps/plugin-dialog'

const router = useRouter()
const coreStore = useCoreStore()
const notificationStore = useNotificationStore()
const { defaultParentPath, launcherName } = storeToRefs(coreStore)
const selectedPath = ref<string>('')
const isLoading = ref<boolean>(false)
const step = ref<1 | 2>(1)

const needsProfile = computed((): boolean => coreStore.offlineBuild && coreStore.projects.length === 0)

watch((): boolean => coreStore.hasLauncherConfig === true, (hasConfig) => {
  if (!hasConfig) {
    step.value = 1
    return
  }
  if (!needsProfile.value) {
    router.replace('/')
    return
  }
  step.value = 2
}, { immediate: true })

watch(defaultParentPath, (val: string | null) => {
  if (val) selectedPath.value = val
}, { immediate: true })

const fullDisplayPath = computed((): string => {
  if (!selectedPath.value || !launcherName.value) return ''
  return joinPath(selectedPath.value, launcherName.value)
})

const selectFolder = async (): Promise<void> => {
  const selected = await open({ directory: true })
  if (selected) selectedPath.value = selected
}

const save = async (): Promise<void> => {
  if (isLoading.value) return
  isLoading.value = true
  try {
    const config = await initializeLauncher(selectedPath.value)
    coreStore.launcherConfig = config
    coreStore.hasLauncherConfig = true
    if (needsProfile.value) {
      step.value = 2
      return
    }
    router.push('/')
  } catch (e: unknown) {
    notificationStore.show(getErrorMessage(e))
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="setup-screen">
    <div class="setup-container">
      <div class="setup-card">
        <div v-if="needsProfile" class="setup-steps">
          <span class="setup-steps__item" :class="{ 'setup-steps__item--active': step === 1 }">Папка установки</span>
          <span class="setup-steps__arrow">→</span>
          <span class="setup-steps__item" :class="{ 'setup-steps__item--active': step === 2 }">Профиль</span>
        </div>

        <template v-if="step === 1">
          <span class="setup-card__eyebrow eyebrow">Первый запуск</span>
          <h1 class="setup-card__title heading-display">Настройка лаунчера</h1>
          <p class="setup-card__description">Укажите папку для хранения файлов лаунчера</p>

          <div class="setup-card__field">
            <Input
              v-model="selectedPath"
              :options="{ placeholder: 'Выберите папку', readonly: true }"
            />
          </div>

          <div v-if="fullDisplayPath" class="setup-preview">
            <span class="setup-preview__label eyebrow">Путь установки</span>
            <span class="setup-preview__path">{{ fullDisplayPath }}</span>
          </div>

          <div class="setup-card__actions">
            <Button class="btn-secondary btn-block" @click="selectFolder">
              Обзор
            </Button>

            <Button
              class="btn-primary btn-lg btn-block"
              :is-loading="isLoading"
              :is-disabled="isLoading || !selectedPath"
              @click="save"
            >
              Сохранить
            </Button>
          </div>
        </template>

        <template v-else>
          <span class="setup-card__eyebrow eyebrow">Первый запуск</span>
          <h1 class="setup-card__title heading-display">Добавить профиль</h1>
          <AddProfileTab embedded />
        </template>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

.setup-screen {
  min-height: 100vh;
  width: 100%;
  background: var(--app-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--layout-padding);
  position: relative;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
    background-size: 80px 80px;
    mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
    -webkit-mask-image: radial-gradient(ellipse at center, black 0%, transparent 75%);
    pointer-events: none;
  }
}

.setup-container {
  width: 100%;
  max-width: var(--page-max-width);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: var(--z-content);
}

.setup-card {
  width: 100%;
  background: var(--login-bg-form);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-modal);
  padding: var(--page-padding-y) var(--page-padding-x);
  box-shadow: var(--elevation-modal);
  text-align: left;

  &__eyebrow {
    display: block;
    margin-bottom: var(--space-12);
  }

  &__title {
    font-size: var(--text-heading);
    margin: 0 0 var(--space-12) 0;
  }

  &__description {
    color: var(--login-text-muted);
    margin: 0 0 var(--title-gap) 0;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
  }

  &__field {
    margin-bottom: var(--space-16);
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
}

.setup-steps {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  margin-bottom: var(--space-24);

  &__item {
    font-family: var(--font-eyebrow);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--login-text-muted);
    font-feature-settings: "tnum" on;

    &--active {
      color: var(--login-text-primary);
    }
  }

  &__arrow {
    color: var(--login-text-muted);
  }
}

.setup-preview {
  margin-bottom: var(--space-24);
  padding: var(--space-12);
  background: var(--surface-subtle);
  box-shadow: var(--elevation-inset);
  border-radius: var(--radius-card);

  &__label {
    display: block;
    margin-bottom: var(--space-4);
  }

  &__path {
    display: block;
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    word-break: break-all;
    font-family: var(--font-mono);
    letter-spacing: normal;
  }
}

@include breakpoints.media-under-md {
  .setup-card {
    padding: var(--space-32) var(--space-24);
  }
}
</style>
