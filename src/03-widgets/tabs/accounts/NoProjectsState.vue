<script setup lang="ts">
import { Button } from '@/06-shared'

const emit = defineEmits<{
  'add-profile': []
}>()
</script>

<template>
  <div class="no-projects-state">
    <div class="no-projects-state__card">
      <span class="eyebrow">Профилей нет</span>
      <p class="no-projects-state__title">В лаунчере ещё нет ни одного проекта</p>
      <p class="no-projects-state__hint">
        Профиль это папка с отдельной версией игры и настройками. Добавьте первый профиль, чтобы
        войти в аккаунт и запустить игру
      </p>
      <Button class="btn-primary btn-lg" @click="emit('add-profile')">
        Добавить профиль
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.no-projects-state {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
}

.no-projects-state__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-12);
  max-width: var(--settings-row-width);
  padding: var(--space-32) var(--space-24);
  text-align: center;
  border-radius: var(--radius-card);
  background: var(--surface-subtle);
  box-shadow: var(--elevation-inset);
}

.no-projects-state__title {
  @include mixins.heading-typography;

  margin: 0;
}

.no-projects-state__hint {
  @include mixins.caption-hint;

  text-align: center;
}
</style>
