<script setup lang="ts">

import { Button, Input, ProgressBar, Checkbox } from '@/06-shared'
import { useCoreStore } from '@/05-entities'
import { useAuth, useGameLaunch } from '@/04-features'
import StepProgress from "@/03-widgets/tabs/login/StepProgress.vue";

const coreStore = useCoreStore()
const {
  isLoading,
  errorMessage,
  logins,
  loginFormData,
  handleLogin: login,
} = useAuth()

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
    <template v-if="!coreStore.isLoggedIn">
      <div class="login-tab__form">
        <h2 class="login-tab__title heading-display">Вход</h2>

        <div class="login-tab__field">
          <Input
            v-model="loginFormData.username"
            :options="{ placeholder: 'Никнейм', list: logins }"
          />
        </div>

        <div class="login-tab__field">
          <Input
            v-model="loginFormData.password"
            :options="{ placeholder: 'Пароль', type: 'password' }"
          />
        </div>

        <div class="login-tab__field">
          <Checkbox
            v-model="loginFormData.rememberMe"
            label="Сохранить данные"
          />
        </div>

        <div v-if="errorMessage" class="login-tab__error">{{ errorMessage }}</div>

        <Button
          class="btn-primary btn-lg btn-block"
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
          <h2 class="login-tab__title heading-display">{{ coreStore.currentProject }}</h2>
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
  padding: var(--space-40) var(--space-32);

  &__form {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__title {
    margin-bottom: var(--space-8);
  }

  &__field {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
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

  &__progress {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
  }

  &__progress-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
}
</style>
