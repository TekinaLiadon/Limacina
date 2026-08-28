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
        class="btn-primary btn-lg btn-block"
        :is-loading="isLoading"
        :is-disabled="isDisabled"
        @click="emit('submit')"
    >
      {{ submitLabel }}
    </Button>
    <Button
        v-if="isBack"
        class="btn-quiet btn-block auth-form__back-btn"
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
  gap: var(--element-gap);

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__error {
    color: var(--error);
    font-size: var(--text-body-sm);
    text-align: left;
    padding: var(--space-12);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    border-radius: var(--radius-badge);
    word-break: break-word;
  }

  &__back-btn {
    min-height: 44px;
  }
}
</style>
