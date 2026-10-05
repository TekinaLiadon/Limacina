<script setup lang="ts">
import { computed } from 'vue'
import { Button, Input, Checkbox } from '@/06-shared'
import { useAuth } from '@/04-features'
import AuthForm from '@/03-widgets/tabs/login/AuthForm.vue'
import { AUTH_LOGIN_TAB, AUTH_REGISTER_TAB, type AuthSubTab } from '@/05-entities'

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
  clearError,
  logins,
  loginFormData,
  registerFormData,
  passwordsMatch,
  isOffline,
  isLoginValid,
  isRegisterValid,
  registerLoginHint,
  registerPasswordHint,
  handleLogin,
  handleRegister,
} = useAuth()

interface AuthButtonTab  {
  text: string
  key: AuthSubTab
}

const tabs: AuthButtonTab[] = [
  {text: 'Вход', key: AUTH_LOGIN_TAB },
  {text: 'Регистрация', key: AUTH_REGISTER_TAB }
]

const showTabs = computed((): boolean => !isOffline.value)
const currentTab = computed((): AuthSubTab => (isOffline.value ? AUTH_LOGIN_TAB : props.activeTab))

const switchTab = (tab: AuthSubTab): void => {
  if (tab === props.activeTab) return
  clearError()
  emit('update:activeTab', tab)
}
</script>

<template>
  <div class="auth-tabs">
    <div v-if="showTabs" class="auth-tabs__tabs">
      <Button
          v-for="el in tabs"
          :key="el.key"
          class="auth-tabs__tab"
          :class="{ 'auth-tabs__tab--active': activeTab === el.key }"
          @click="switchTab(el.key)"
        >
        {{el.text}}
      </Button>
    </div>

    <div class="auth-tabs__content">
      <AuthForm
        v-if="currentTab === AUTH_LOGIN_TAB"
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
        :is-back="showBack ?? false"
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
        :is-disabled="!isRegisterValid"
        :error-message="errorMessage"
        :username-hint="registerLoginHint ?? ''"
        :password-hint="registerPasswordHint ?? ''"
        username-placeholder="Логин"
        @submit="handleRegister"
        @back="emit('back')"
        :is-back="showBack ?? false"
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
@use '@/01-app/assets/mixins';
.auth-tabs {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;

  &__tabs {
    @include mixins.segmented;

    margin-bottom: var(--tabs-gap);
  }

  &__tab {
    @include mixins.segmented-item($disabled-opacity: null);

    flex: 1;
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
