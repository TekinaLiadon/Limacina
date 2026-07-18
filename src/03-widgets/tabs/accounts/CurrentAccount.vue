<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  username: string
}>()

defineEmits<{
  'launch': []
  'show-login': []
  'go-to-accounts': []
}>()
</script>

<template>
  <div class="current-account">
    <p class="current-account__label">Текущий аккаунт:</p>
    <p class="current-account__name">{{ username }}</p>

    <div class="current-account__actions">
      <Button
        class="btn-yellow current-account__btn"
        @click="$emit('launch')"
      >
        Войти
      </Button>
      <Button
        class="btn-yellow current-account__btn current-account__btn--secondary"
        @click="$emit('show-login')"
      >
        Ввести новый
      </Button>
      <Button
        class="btn-yellow current-account__btn current-account__btn--secondary"
        @click="$emit('go-to-accounts')"
      >
        Выбрать другой
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.current-account {
  width: 100%;
  display: flex;
  flex-direction: column;

  &__label {
    font-size: 14px;
    color: var(--login-text-secondary);
    margin: 0;
  }

  &__name {
    font-size: 24px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    margin-top: 12px;
  }

  &__btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;

    &--secondary {
      background: transparent;
      border: 1px solid var(--login-border);
      color: var(--login-text-primary);

      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }
    }
  }
}
</style>
