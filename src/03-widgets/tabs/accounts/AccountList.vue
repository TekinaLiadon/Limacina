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
    <h2 class="account-list__title">Аккаунты</h2>

    <div class="account-list__items">
      <Button
          class="btn-yellow current-account__btn current-account__btn--secondary"
          @click="$emit('show-login')"
      >
        Ввести новый
      </Button>
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
          class="btn-yellow account-list__select-btn"
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
    font-size: 28px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 24px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__items {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 20px;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    background: var(--surface-subtle);
    border: 1px solid var(--login-border);
    border-radius: 12px;
    transition: all 0.2s ease;

    &:hover {
      background: var(--surface-hover);
      border-color: var(--login-accent);
    }

    &--selected {
      background: var(--accent-hover-bg);
      border-color: var(--login-accent);
    }
  }

  &__avatar {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--login-accent);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 800;
    font-family: "Manrope", sans-serif;
    flex-shrink: 0;
    line-height: 1;
  }

  &__name {
    flex: 1;
    font-size: 16px;
    font-weight: 500;
    color: var(--login-text-primary);
  }

  &__select-btn {
    flex: 0 0 auto;
    padding: 0 20px;
    height: 36px;
    font-size: 13px;
  }

  &__check {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--accent-active-bg);
    color: var(--login-accent);
    flex-shrink: 0;
  }

  &__delete-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: transparent;
    border: 1px solid var(--login-border);
    color: var(--login-text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;

    &:hover:not(:disabled) {
      background: var(--delete-bg);
      border-color: var(--delete-border);
      color: var(--delete-text);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__error {
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: 13px;
    margin-top: 16px;
    word-break: break-word;
  }
}
</style>
