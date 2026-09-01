<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  logins: string[]
  isLoading: boolean
  selectedUsername: string
  isSelected: (login: string) => boolean
  errorMessage?: string
}>()

defineEmits<{
  'select': [username: string]
  'delete': [username: string]
  'show-login': []
}>()
</script>

<template>
  <div class="account-list">
    <h2 class="account-list__title heading-display">Аккаунты</h2>

    <div class="account-list__items">
      <Button
          class="btn-secondary btn-block account-list__add-btn"
          @click="$emit('show-login')"
      >
        Ввести новый
      </Button>

      <div v-if="logins.length > 0" class="account-list__divider section-label">Сохранённые</div>

      <div
        v-for="login in logins"
        :key="login"
        class="account-list__item"
        :class="{ 'account-list__item--selected': isSelected(login) }"
      >
        <span class="account-list__avatar">
          {{ login.charAt(0).toUpperCase() }}
        </span>
        <span class="account-list__name">{{ login }}</span>
        <Button
          v-if="!isSelected(login)"
          class="btn-primary account-list__select-btn"
          :is-loading="isLoading && selectedUsername === login"
          :is-disabled="isLoading"
          @click="$emit('select', login)"
        >
          Выбрать
        </Button>
        <span v-else class="account-list__check">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 10L8 14L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <button
          v-if="!isSelected(login)"
          class="account-list__delete-btn"
          :disabled="isLoading"
          aria-label="Удалить аккаунт"
          @click="$emit('delete', login)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="account-list__error">
      {{ errorMessage }}
    </div>
  </div>
</template>

<style lang="scss">
.account-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  height: 100%;

  &__title {
    margin-bottom: var(--title-gap);
  }

  &__items {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: var(--space-8);
  }

  &__add-btn {
    min-height: var(--control-height);
  }

  &__divider {
    margin: var(--space-8) 0;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-12);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-card);
    transition: background-color 0.2s ease, box-shadow 0.2s ease;

    &:hover {
      background: var(--surface-hover);
      box-shadow: var(--elevation-inset-strong);
    }

    &--selected {
      background: var(--accent-subtle);
      box-shadow: inset 0 0 0 1px var(--login-accent);
    }
  }

  &__avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-circle);
    background: var(--login-accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display);
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    letter-spacing: normal;
    flex-shrink: 0;
    line-height: 1;
  }

  &__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }

  &__select-btn {
    flex: 0 0 auto;
  }

  &__check {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-circle);
    background: var(--accent-active-bg);
    box-shadow: var(--elevation-inset);
    color: var(--accent-text);
    flex-shrink: 0;
  }

  &__delete-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-circle);
    background: transparent;
    border: none;
    box-shadow: var(--elevation-inset);
    color: var(--login-text-muted);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
    flex-shrink: 0;

    &:hover:not(:disabled) {
      background: var(--delete-bg);
      box-shadow: inset 0 0 0 1px var(--delete-border);
      color: var(--delete-text);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__error {
    padding: var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    color: var(--error);
    font-size: var(--text-body-sm);
    text-align: left;
    margin-top: var(--space-16);
    word-break: break-word;
  }
}
</style>
