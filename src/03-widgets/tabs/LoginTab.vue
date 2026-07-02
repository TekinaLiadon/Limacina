<script setup lang="ts">

import { Button, Input, ProgressBar, PushNotification } from '@/06-shared'
import { useCoreStore } from '@/05-entities'
import { useAuthLogin, useGameLaunch } from '@/04-features'
import StepProgress from "@/03-widgets/tabs/login/StepProgress.vue";

const coreStore = useCoreStore()
const {
  isLoading,
  errorMessage,
  logins,
  showNotification,
  formData,
  handleLogin: login,
} = useAuthLogin()

const {
  launchSteps,
  activeProgress,
  executeSteps,
} = useGameLaunch()

const handleLogin = async (): Promise<void> => {
  await login()
  if (coreStore.isLoggedIn) await executeSteps()
}
</script>

<template>
  <div class="login-tab">
    <PushNotification
      :visible="showNotification"
      message="Авторизация прошла успешно"
      @update:visible="showNotification = $event"
    />

    <template v-if="!coreStore.isLoggedIn">
      <div class="login-tab__form">
        <h2 class="login-tab__title">Вход</h2>

        <div class="login-tab__field">
          <Input
            v-model="formData.username"
            :options="{ placeholder: 'Никнейм', list: logins }"
          />
        </div>

        <div class="login-tab__field">
          <Input
            v-model="formData.password"
            :options="{ placeholder: 'Пароль', type: 'password' }"
          />
        </div>

        <div class="login-tab__field">
          <label class="login-tab__checkbox" @click.prevent="formData.rememberMe = !formData.rememberMe">
            <span class="login-tab__check" :class="{ 'login-tab__check--checked': formData.rememberMe }">
              <svg v-if="formData.rememberMe" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6L5 9L10 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>Сохранить данные</span>
          </label>
        </div>

        <div v-if="errorMessage" class="login-tab__error">{{ errorMessage }}</div>

        <Button
          class="btn-yellow login-tab__btn"
          :is-loading="isLoading"
          :is-disabled="isLoading"
          @click="handleLogin"
        >
          Войти
        </Button>
      </div>
    </template>

    <template v-else>
      <div class="login-tab__progress">
        <div class="login-tab__progress-header">
          <h2 class="login-tab__title">{{ coreStore.currentProject }}</h2>
          <ProgressBar :progress="activeProgress" />
        </div>

        <StepProgress :steps="launchSteps" />

        <div v-if="coreStore.loginError" class="login-tab__error">
          {{ coreStore.loginError }}
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss">
.login-tab {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: 40px;

  &__form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 8px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
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

  &__btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 8px;
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

  &__progress {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  &__progress-header {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
}
</style>
