<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button, Input } from '@/06-shared'
import type { RegisterForm } from '@/03-widgets/types'

const formData = ref<RegisterForm>({
  login: '',
  password: '',
  confirmPassword: '',
})

const passwordsMatch = computed((): boolean => {
  if (!formData.value.confirmPassword) return true
  return formData.value.password === formData.value.confirmPassword
})

const isValid = computed((): boolean => {
  return (
    formData.value.login.length > 0 &&
    formData.value.password.length > 0 &&
    formData.value.confirmPassword.length > 0 &&
    passwordsMatch.value
  )
})

const handleSubmit = (): void => {
  if (!isValid.value) return
  // TODO: backend request
}
</script>

<template>
  <div class="register-tab">
    <h2 class="register-tab__title">Регистрация</h2>

    <div class="register-tab__form">
      <div class="register-tab__field">
        <Input
          v-model="formData.login"
          :options="{ placeholder: 'Логин' }"
        />
      </div>

      <div class="register-tab__field">
        <Input
          v-model="formData.password"
          :options="{ placeholder: 'Пароль', type: 'password' }"
        />
      </div>

      <div class="register-tab__field">
        <Input
          v-model="formData.confirmPassword"
          :options="{ placeholder: 'Повторите пароль', type: 'password' }"
        />
        <span v-if="!passwordsMatch" class="register-tab__error">
          Пароли не совпадают
        </span>
      </div>

      <Button
        class="btn-yellow register-tab__btn"
        :is-disabled="!isValid"
        @click="handleSubmit"
      >
        Зарегистрироваться
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.register-tab {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: 40px;

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 24px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__error {
    font-size: 12px;
    color: var(--error);
  }

  &__btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 8px;
  }
}
</style>
