<script setup lang="ts">
import { useAccountsPage, useProjectConfig } from '@/04-features'
import { useCoreStore } from '@/05-entities'
import { LaunchScene } from '@/03-widgets'

useProjectConfig()

const coreStore = useCoreStore()
const {
  isLoading,
  errorMessage,
  logins,
  selectedUsername,
  handleSelect,
  isLaunching,
  showAuth,
  activeSubTab,
  launchSteps,
  activeProgress,
  loginError,
  sceneUsername,
  isCancelPending,
  handleLaunch,
  showLoginForm,
  goToAccounts,
  handleDeleteAccount,
  showBack,
} = useAccountsPage()
</script>

<template>
  <div class="accounts-page">
    <LaunchScene
      v-model:active-tab="activeSubTab"
      :username="sceneUsername"
      :selected-username="selectedUsername"
      :has-session="coreStore.isLoggedIn"
      :logins="logins"
      :is-loading="isLoading"
      :is-launching="isLaunching"
      :is-cancel-pending="isCancelPending"
      :progress="activeProgress"
      :steps="launchSteps"
      :login-error="loginError"
      :select-error="errorMessage"
      :show-auth="showAuth"
      :show-back="showBack"
      @launch="handleLaunch"
      @select="handleSelect"
      @delete-account="handleDeleteAccount"
      @show-login="showLoginForm"
      @cancel="goToAccounts"
      @auth-back="goToAccounts"
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
