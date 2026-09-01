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
    <span class="current-account__label eyebrow">Текущий аккаунт</span>
    <p class="current-account__name">{{ username }}</p>

    <div class="current-account__actions">
      <Button
        class="btn-primary btn-lg btn-block"
        @click="$emit('launch')"
      >
        Войти
      </Button>
      <Button
        class="btn-secondary btn-block current-account__btn"
        @click="$emit('show-login')"
      >
        Ввести новый
      </Button>
      <Button
        class="btn-quiet btn-block current-account__btn"
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
    margin-bottom: var(--space-8);
  }

  &__name {
    font-family: var(--font-display);
    font-size: var(--text-heading-sm);
    line-height: var(--leading-heading);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-heading);
    color: var(--login-text-primary);
    margin: 0 0 var(--title-gap) 0;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    width: 100%;
  }

  &__btn {
    min-height: var(--control-height);
  }
}
</style>
