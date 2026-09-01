<script setup lang="ts">
import { IconButton } from '@/06-shared'
import type { TabItem, TabKey } from '@/03-widgets/types'

defineProps<{
  activeTab: TabKey
}>()

const emit = defineEmits<{
  navigate: [key: TabKey]
}>()

const items: TabItem[] = [
  { key: 'accounts', icon: 'home', label: 'Аккаунты' },
  { key: 'add-profile', icon: 'referals', label: 'Новый профиль' },
  { key: 'settings', icon: 'settings', label: 'Настройки' },
  { key: 'debug', icon: 'settings', label: 'Дебаг' },
]
</script>

<template>
  <div class="sidebar">
    <div class="sidebar__tabs">
      <button
        v-for="item in items"
        :key="item.key"
        class="sidebar__item"
        :class="{
          'sidebar__item--active': activeTab === item.key,
          'sidebar__item--disabled': item.disabled,
        }"
        @click="!item.disabled && emit('navigate', item.key)"
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
  flex-shrink: 0;
  width: var(--sidebar-width);
  background: var(--login-bg-form);
  border-radius: var(--radius-card);
  box-shadow: var(--elevation-card);
  padding: var(--panel-padding-y) var(--panel-padding-x);

  &__tabs {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex: 1;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-4) var(--space-12) var(--space-4) var(--space-4);
    border-radius: var(--radius-button);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
    color: var(--login-text-secondary);
    font-family: inherit;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    font-weight: var(--weight-medium);
    text-align: left;
    width: 100%;

    &:hover:not(&--disabled) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      color: var(--login-text-primary);
      background: var(--surface-light);
      box-shadow: var(--elevation-inset);
    }

    &--disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .icon-btn {
      width: var(--control-height-sm);
      height: var(--control-height-sm);
      flex-shrink: 0;
      background-color: transparent;
      box-shadow: none;

      &__icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    &:hover:not(&--disabled) .icon-btn {
      background-color: var(--surface-hover);
      box-shadow: var(--elevation-inset);

      .icon-btn__icon {
        color: var(--login-text-primary);
      }
    }

    &--active .icon-btn {
      background-color: var(--accent-active-bg);
      box-shadow: var(--elevation-inset);

      .icon-btn__icon {
        color: var(--accent-text);
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

    &__tabs {
      flex-direction: row;
      gap: var(--space-4);
      overflow-x: auto;
    }

    &__item {
      flex-direction: column;
      gap: var(--space-4);
      padding: var(--space-8) var(--space-12);
      min-width: fit-content;
      border-radius: var(--radius-card);
    }

    &__label {
      font-size: var(--text-caption);
    }
  }

  @include breakpoints.media-under-sm {
    &__label {
      display: none;
    }
  }
}
</style>
