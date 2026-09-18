<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAccountsPage, useGameSession, useProjectConfig, useProjectSwitch } from '@/04-features'
import { useCoreStore } from '@/05-entities'
import { Preloader } from '@/06-shared'
import { LaunchScene, NoProjectsState } from '@/03-widgets'

useProjectConfig()

const router = useRouter()
const coreStore = useCoreStore()
const { minimizeToTray } = useGameSession()
const { isSwitching } = useProjectSwitch()
const {
  isLoading,
  errorMessage,
  logins,
  loginsError,
  loadAccounts,
  selectedUsername,
  handleSelect,
  isLaunching,
  showAuth,
  activeSubTab,
  launchSteps,
  activeProgress,
  launchInterrupted,
  loginError,
  sceneUsername,
  isCancelPending,
  isServerOffline,
  handleLaunch,
  showLoginForm,
  goToAccounts,
  handleDeleteAccount,
  showBack,
} = useAccountsPage()
</script>

<template>
  <div class="accounts-page">
    <Preloader v-if="isSwitching" text="Смена проекта…" />
    <NoProjectsState
      v-else-if="coreStore.projects.length === 0"
      @add-profile="router.push({ name: 'AddProfile' })"
    />
    <LaunchScene v-else
      v-model:active-tab="activeSubTab"
      :username="sceneUsername"
      :selected-username="selectedUsername"
      :has-session="coreStore.isLoggedIn"
      :logins="logins"
      :is-loading="isLoading"
      :is-launching="isLaunching"
      :is-cancel-pending="isCancelPending"
      :is-interrupted="launchInterrupted"
      :progress="activeProgress"
      :steps="launchSteps"
      :session-username="coreStore.gameUsername"
      :server-offline="isServerOffline"
      :login-error="loginError"
      :select-error="errorMessage"
      :logins-error="loginsError"
      :show-auth="showAuth"
      :show-back="showBack"
      @launch="handleLaunch"
      @select="handleSelect"
      @delete-account="handleDeleteAccount"
      @show-login="showLoginForm"
      @retry-logins="loadAccounts"
      @cancel="goToAccounts"
      @auth-back="goToAccounts"
      @minimize="minimizeToTray"
    />
  </div>
</template>

<style lang="scss">
.accounts-page {
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: var(--page-padding-y) var(--page-padding-x);
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
