<script setup lang="ts">
import { Icon } from '@/06-shared'
import type { ProfileKind } from '@/05-entities/core/types'

const emit = defineEmits<{
  select: [kind: ProfileKind]
}>()

interface KindCard {
  kind: ProfileKind
  icon: string
  title: string
  description: string
}

const cards: KindCard[] = [
  {
    kind: 'server',
    icon: 'referals',
    title: 'Добавить сервер',
    description: 'Подключение по адресу сервера. Версия, сборка и моды приходят с сервера.',
  },
  {
    kind: 'offline',
    icon: 'home',
    title: 'Одиночная игра',
    description: 'Локальный профиль без сети: сами выбираете версию и загрузчик модов.',
  },
]
</script>

<template>
  <div class="profile-kind">
    <div class="profile-kind__head">
      <h2 class="profile-kind__title heading-display">Что добавляем?</h2>
      <p class="profile-kind__subtitle">Выберите тип профиля</p>
    </div>

    <div class="profile-kind__cards">
      <button
        v-for="card in cards"
        :key="card.kind"
        class="profile-kind__card"
        type="button"
        @click="emit('select', card.kind)"
      >
        <span class="profile-kind__card-icon">
          <Icon :type="card.icon" />
        </span>
        <span class="profile-kind__card-body">
          <span class="profile-kind__card-title">{{ card.title }}</span>
          <span class="profile-kind__card-text">{{ card.description }}</span>
        </span>
        <Icon class="profile-kind__card-arrow" type="arrow-right" />
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.profile-kind {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__title {
    font-size: var(--text-heading);
  }

  &__subtitle {
    margin: 0;
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
  }

  &__cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__card {
    display: flex;
    align-items: center;
    gap: var(--space-16);
    width: 100%;
    padding: var(--space-16);
    text-align: left;
    border: none;
    cursor: pointer;
    font-family: inherit;
    border-radius: var(--radius-card);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    transition: background-color 0.2s ease, box-shadow 0.2s ease;

    &:hover {
      background: var(--surface-hover);
      box-shadow: var(--elevation-card);
    }
  }

  &__card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-circle);
    background: var(--accent-active-bg);
    color: var(--accent-text);
  }

  &__card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1;
    min-width: 0;
  }

  &__card-title {
    font-size: var(--text-body);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }

  &__card-text {
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
  }

  &__card-arrow {
    flex-shrink: 0;
    color: var(--login-text-muted);
  }
}
</style>
