<script setup lang="ts">
import {Button, Input} from '@/06-shared'

defineProps<{
  username: string
  password: string
  submitLabel: string
  isLoading: boolean
  isDisabled: boolean
  isBack?: boolean
  errorMessage?: string
  usernamePlaceholder?: string
  passwordPlaceholder?: string
  usernameList?: string[]
}>()

const emit = defineEmits<{
  'update:username': [value: string]
  'update:password': [value: string]
  'submit': []
  'back': []
}>()
</script>

<template>
  <div class="auth-form">
    <div class="auth-form__field">
      <Input
          :model-value="username"
          @update:model-value="emit('update:username', $event)"
          :options="{ placeholder: usernamePlaceholder ?? 'Никнейм', list: usernameList }"
      />
    </div>

    <div class="auth-form__field">
      <Input
          :model-value="password"
          @update:model-value="emit('update:password', $event)"
          :options="{ placeholder: passwordPlaceholder ?? 'Пароль', type: 'password' }"
      />
    </div>

    <slot/>

    <div v-if="errorMessage" class="auth-form__error">{{ errorMessage }}</div>

    <Button
        class="btn-yellow auth-form__btn"
        :is-loading="isLoading"
        :is-disabled="isDisabled"
        @click="emit('submit')"
    >
      {{ submitLabel }}
    </Button>
    <Button
        v-if="isBack"
        class="btn-yellow auth-form__btn auth-form__btn--secondary"
        @click="emit('back')"
    >
      Назад к аккаунтам
    </Button>
  </div>
</template>

<style lang="scss">
.auth-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__error {
    color: var(--error);
    font-size: 13px;
    padding: 10px 14px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: 8px;
    word-break: break-word;
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
