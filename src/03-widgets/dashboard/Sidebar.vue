<script setup lang="ts">
import { useCoreStore } from '@/05-entities'
import { IconButton } from '@/06-shared'
import type { TabItem, TabKey } from '@/03-widgets/types'

const coreStore = useCoreStore()

const items: TabItem[] = [
  { key: 'login', icon: 'home', label: 'Войти' },
  { key: 'add-server', icon: 'referals', label: 'Добавить сервер', disabled: true },
  { key: 'register', icon: 'referals', label: 'Аккаунты' },
  { key: 'settings', icon: 'settings', label: 'Настройки' },
  { key: 'debug', icon: 'settings', label: 'Дебаг' },
]

const setActiveTab = (key: TabKey): void => {
  coreStore.activeTab = key
}
</script>

<template>
  <div class="sidebar">
    <div class="sidebar__tabs">
      <button
        v-for="item in items"
        :key="item.key"
        class="sidebar__item"
        :class="{
          'sidebar__item--active': coreStore.activeTab === item.key,
          'sidebar__item--disabled': item.disabled,
        }"
        @click="setActiveTab(item.key)"
      >
        <IconButton tag="span" :icon="item.icon" />
        <span class="sidebar__label">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

.sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  background: var(--login-bg-form);
  border-radius: 16px;
  padding: 20px 12px;
  gap: 8px;

  &__tabs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
    color: var(--login-text-secondary);
    font-size: 14px;
    text-align: left;
    width: 100%;

    &:hover:not(&--disabled) {
      color: var(--login-text-primary);
    }

    &--active {
      color: var(--login-text-primary);
    }

    &--disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .icon-btn {
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      background-color: transparent;
      transition: all 0.2s ease;

      &__icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--login-text-secondary);
        transition: color 0.2s ease;
      }
    }

    &:hover:not(&--disabled) .icon-btn {
      background-color: rgba(108, 127, 216, 0.15);

      .icon-btn__icon {
        color: var(--login-text-primary);
      }
    }

    &--active .icon-btn {
      background-color: rgba(108, 127, 216, 0.2);

      .icon-btn__icon {
        color: var(--login-accent);
      }
    }
  }

  &__label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @include breakpoints.media-under-lg {
    width: 100%;
    flex-direction: row;
    border-radius: 16px 16px 0 0;
    padding: 12px 16px;
    position: fixed;
    bottom: 0;
    left: 0;
    z-index: 10;

    &__tabs {
      flex-direction: row;
      gap: 4px;
      overflow-x: auto;
    }

    &__item {
      flex-direction: column;
      gap: 4px;
      padding: 8px 12px;
      min-width: fit-content;
    }

    &__label {
      font-size: 10px;
    }
  }

  @include breakpoints.media-under-sm {
    &__label {
      display: none;
    }
  }
}
</style>
