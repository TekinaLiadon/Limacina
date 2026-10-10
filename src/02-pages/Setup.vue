<script setup lang="ts">
import { useSetup } from '@/04-features'
import { Button, Input } from '@/06-shared'
import { AddProfileTab } from '@/03-widgets'

const {
  selectedPath,
  isLoading,
  step,
  needsProfile,
  fullDisplayPath,
  selectFolder,
  save,
} = useSetup()
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
@use '@/01-app/assets/mixins';

.setup-screen {
  @include mixins.fullscreen-page;
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
  @include mixins.fullscreen-card;

  backdrop-filter: blur(var(--popup-overlay-blur));
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
    @include mixins.eyebrow;

    font-family: var(--font-eyebrow);
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
  @include mixins.subtle-card;

  margin-bottom: var(--space-24);

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
