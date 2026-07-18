<script setup lang="ts">
import { Button, Input } from '@/06-shared'
import { useAuthLogin, useAuthRegister } from '@/04-features'
import { AuthForm } from '@/03-widgets'
import type { AuthSubTab } from '@/05-entities/core/types'

defineProps<{
  activeTab: AuthSubTab
  showBack?: boolean
}>()

const emit = defineEmits<{
  'update:activeTab': [tab: AuthSubTab]
  'back': []
}>()

const {
  isLoading: loginLoading,
  errorMessage: loginError,
  logins,
  formData: loginData,
  handleLogin,
} = useAuthLogin()

const {
  isLoading: registerLoading,
  errorMessage: registerError,
  formData: registerData,
  passwordsMatch,
  isValid,
  handleSubmit,
} = useAuthRegister()

interface AuthButtonTab  {
  text: string
  key: AuthSubTab
}

const tabs: AuthButtonTab[] = [
  {text: "Вход", key: "login" },
  {text: "Регистрация", key: "register" }
]
</script>

<template>
  <div class="auth-tabs">
    <div class="auth-tabs__tabs">
      <Button
          v-for="el in tabs"
          class="auth-tabs__tab"
          :class="{ 'auth-tabs__tab--active': activeTab === el.key }"
          @click="emit('update:activeTab', el.key)"
        >
        {{el.text}}
      </Button>
    </div>

    <div class="auth-tabs__content">
      <AuthForm
        v-if="activeTab === 'login'"
        v-model:username="loginData.username"
        v-model:password="loginData.password"
        submit-label="Войти"
        :is-loading="loginLoading"
        :is-disabled="loginData.username.length < 4 || loginData.password.length < 4"
        :error-message="loginError"
        :username-list="logins"
        @submit="handleLogin"
        @back="emit('back')"
        :is-back="showBack"
      >
        <label class="auth-tabs__checkbox" @click.prevent="loginData.rememberMe = !loginData.rememberMe">
          <span class="auth-tabs__check" :class="{ 'auth-tabs__check--checked': loginData.rememberMe }">
            <svg v-if="loginData.rememberMe" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span>Сохранить данные</span>
        </label>
      </AuthForm>

      <AuthForm
        v-else
        v-model:username="registerData.login"
        v-model:password="registerData.password"
        submit-label="Зарегистрироваться"
        :is-loading="registerLoading"
        :is-disabled="!isValid || registerData.login.length < 4 || registerData.password.length < 4"
        :error-message="registerError"
        username-placeholder="Логин"
        @submit="handleSubmit"
        @back="emit('back')"
        :is-back="showBack"
      >
        <div class="auth-tabs__field">
          <Input
            :model-value="registerData.confirmPassword"
            @update:model-value="registerData.confirmPassword = $event"
            :options="{ placeholder: 'Повторите пароль', type: 'password' }"
          />
          <span v-if="!passwordsMatch" class="auth-tabs__error">
            Пароли не совпадают
          </span>
        </div>
      </AuthForm>
    </div>
  </div>
</template>

<style lang="scss">
.auth-tabs {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;

  &__tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 4px;
  }

  &__tab {
    flex: 1;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--login-text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
    }

    &--active {
      background: rgba(255, 255, 255, 0.1);
      color: var(--login-text-primary);
    }
  }

  &__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__checkbox {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    color: var(--login-text-secondary);
    user-select: none;
  }

  &__check {
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--login-border);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
    color: transparent;

    &--checked {
      background: var(--login-accent);
      border-color: var(--login-accent);
      color: var(--white);
    }
  }

  &__error {
    font-size: 12px;
    color: var(--error);
  }
}
</style>
