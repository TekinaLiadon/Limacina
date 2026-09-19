<script setup lang="ts">
import { Button, Input } from '@/06-shared'

const props = withDefaults(defineProps<{
  username: string
  password: string
  submitLabel: string
  isLoading: boolean
  isDisabled: boolean
  isBack?: boolean
  hidePassword?: boolean
  errorMessage?: string
  usernamePlaceholder?: string
  passwordPlaceholder?: string
  usernameList?: string[]
}>(), {
  isBack: false,
  hidePassword: false,
  errorMessage: '',
  usernamePlaceholder: '',
  passwordPlaceholder: '',
  usernameList: () => [],
})

const emit = defineEmits<{
  'update:username': [value: string]
  'update:password': [value: string]
  'submit': []
  'back': []
}>()

const handleSubmit = (): void => {
  if (props.isLoading || props.isDisabled) return
  emit('submit')
}
</script>

<template>
  <form class="auth-form" @submit.prevent="handleSubmit">
    <div class="auth-form__field">
      <Input
          :model-value="username"
          @update:model-value="emit('update:username', $event)"
          :options="{ placeholder: usernamePlaceholder || 'Никнейм', list: usernameList ?? [] }"
      />
    </div>

    <div v-if="!hidePassword" class="auth-form__field">
      <Input
          :model-value="password"
          @update:model-value="emit('update:password', $event)"
          :options="{ placeholder: passwordPlaceholder || 'Пароль', type: 'password' }"
      />
    </div>

    <slot/>

    <div v-if="errorMessage" class="auth-form__error">{{ errorMessage }}</div>

    <Button
        class="btn-primary btn-lg btn-block"
        type="submit"
        :is-loading="isLoading"
        :is-disabled="isDisabled"
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
  </form>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
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
    @include mixins.error-box;
  }

  &__back-btn {
    min-height: var(--control-height);
  }
}
</style>
