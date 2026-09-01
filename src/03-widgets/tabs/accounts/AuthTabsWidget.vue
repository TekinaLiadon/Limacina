<script setup lang="ts">
import { computed } from 'vue'
import { Button, Input, Checkbox } from '@/06-shared'
import { useAuth } from '@/04-features'
import { AuthForm } from '@/03-widgets'
import type { AuthSubTab } from '@/05-entities/core/types'

const props = defineProps<{
  activeTab: AuthSubTab
  showBack?: boolean
}>()

const emit = defineEmits<{
  'update:activeTab': [tab: AuthSubTab]
  'back': []
}>()

const {
  isLoading,
  errorMessage,
  logins,
  loginFormData,
  registerFormData,
  passwordsMatch,
  isOffline,
  isLoginValid,
  isRegisterValid,
  handleLogin,
  handleRegister,
} = useAuth()

interface AuthButtonTab  {
  text: string
  key: AuthSubTab
}

const tabs: AuthButtonTab[] = [
  {text: "Вход", key: "login" },
  {text: "Регистрация", key: "register" }
]

const showTabs = computed((): boolean => !isOffline.value)
const currentTab = computed((): AuthSubTab => (isOffline.value ? 'login' : props.activeTab))
</script>

<template>
  <div class="auth-tabs">
    <div v-if="showTabs" class="auth-tabs__tabs">
      <Button
          v-for="el in tabs"
          :key="el.key"
          class="auth-tabs__tab"
          :class="{ 'auth-tabs__tab--active': activeTab === el.key }"
          @click="emit('update:activeTab', el.key)"
        >
        {{el.text}}
      </Button>
    </div>

    <div class="auth-tabs__content">
      <AuthForm
        v-if="currentTab === 'login'"
        v-model:username="loginFormData.username"
        v-model:password="loginFormData.password"
        :submit-label="isOffline ? 'Играть' : 'Войти'"
        :is-loading="isLoading"
        :is-disabled="!isLoginValid"
        :error-message="errorMessage"
        :username-list="logins"
        :hide-password="isOffline"
        @submit="handleLogin"
        @back="emit('back')"
        :is-back="showBack"
      >
        <Checkbox
          v-if="!isOffline"
          v-model="loginFormData.rememberMe"
          label="Сохранить данные"
        />
      </AuthForm>

      <AuthForm
        v-else
        v-model:username="registerFormData.login"
        v-model:password="registerFormData.password"
        submit-label="Зарегистрироваться"
        :is-loading="isLoading"
        :is-disabled="!isRegisterValid || registerFormData.login.length < 4 || registerFormData.password.length < 4"
        :error-message="errorMessage"
        username-placeholder="Логин"
        @submit="handleRegister"
        @back="emit('back')"
        :is-back="showBack"
      >
        <div class="auth-tabs__field">
          <Input
            :model-value="registerFormData.confirmPassword"
            @update:model-value="registerFormData.confirmPassword = $event"
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
    gap: var(--space-4);
    margin-bottom: var(--tabs-gap);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-pill);
    padding: var(--space-4);
  }

  &__tab {
    flex: 1;
    border-radius: var(--radius-pill);
    background: transparent;
    box-shadow: none;
    color: var(--login-text-muted);

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      background: var(--surface-active);
      box-shadow: var(--elevation-inset);
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
    gap: var(--space-4);
  }

  &__error {
    font-size: var(--text-caption);
    text-align: left;
    color: var(--error);
  }
}
</style>
