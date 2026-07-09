<script setup lang="ts">
import { Button, Input } from '@/06-shared'

defineProps<{
  formData: {
    login: string
    password: string
    confirmPassword: string
  }
  isLoading: boolean
  errorMessage: string
  passwordsMatch: boolean
  isValid: boolean
}>()

const emit = defineEmits<{
  'submit': []
}>()
</script>

<template>
  <div class="accounts-tab__form">
    <h2 class="accounts-tab__title">Регистрация</h2>

    <div class="accounts-tab__field">
      <Input
        :model-value="formData.login"
        @update:model-value="formData.login = $event"
        :options="{ placeholder: 'Логин' }"
      />
    </div>

    <div class="accounts-tab__field">
      <Input
        :model-value="formData.password"
        @update:model-value="formData.password = $event"
        :options="{ placeholder: 'Пароль', type: 'password' }"
      />
    </div>

    <div class="accounts-tab__field">
      <Input
        :model-value="formData.confirmPassword"
        @update:model-value="formData.confirmPassword = $event"
        :options="{ placeholder: 'Повторите пароль', type: 'password' }"
      />
      <span v-if="!passwordsMatch" class="accounts-tab__error">
        Пароли не совпадают
      </span>
    </div>

    <div v-if="errorMessage" class="accounts-tab__error accounts-tab__error--box">
      {{ errorMessage }}
    </div>

    <div class="accounts-tab__actions">
      <Button
        class="btn-yellow accounts-tab__submit-btn"
        :is-loading="isLoading"
        :is-disabled="!isValid || isLoading"
        @click="emit('submit')"
      >
        Зарегистрироваться
      </Button>
    </div>
  </div>
</template>
