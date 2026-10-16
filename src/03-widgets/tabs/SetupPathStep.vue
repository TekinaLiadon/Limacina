<script setup lang="ts">
import { Button, Input } from '@/06-shared'
import { useSetup } from '@/04-features'

const {
  selectedPath,
  isLoading,
  fullDisplayPath,
  selectFolder,
  save,
} = useSetup()
</script>

<template>
  <div class="setup-path-step">
    <span class="setup-path-step__eyebrow eyebrow">Первый запуск</span>
    <h1 class="setup-path-step__title heading-display">Настройка лаунчера</h1>
    <p class="setup-path-step__description">Укажите папку для хранения файлов лаунчера</p>

    <div class="setup-path-step__field">
      <Input
        v-model="selectedPath"
        :options="{ placeholder: 'Выберите папку', readonly: true }"
      />
    </div>

    <div v-if="fullDisplayPath" class="setup-path-step__preview">
      <span class="setup-path-step__preview-label eyebrow">Путь установки</span>
      <span class="setup-path-step__preview-path">{{ fullDisplayPath }}</span>
    </div>

    <div class="setup-path-step__actions">
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
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.setup-path-step {
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

  &__preview {
    @include mixins.subtle-card;

    margin-bottom: var(--space-24);
  }

  &__preview-label {
    display: block;
    margin-bottom: var(--space-4);
  }

  &__preview-path {
    display: block;
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    word-break: break-all;
    font-family: var(--font-mono);
    letter-spacing: normal;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
}
</style>
