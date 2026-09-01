<script setup lang="ts">
import { useAccountsPage, useProjectConfig } from '@/04-features'
import { AccountList, CurrentAccount, LaunchProgress, AuthTabsWidget } from '@/03-widgets'

useProjectConfig()

const {
  isLoading,
  errorMessage,
  logins,
  selectedUsername,
  handleSelect,
  showAccountList,
  showCurrentAccount,
  showLaunchProgress,
  showAuthTabs,
  isSelected,
  activeSubTab,
  launchSteps,
  activeProgress,
  loginError,
  sessionUsername,
  handleLaunch,
  showLoginForm,
  goToAccounts,
  handleDeleteAccount,
  showBack,
} = useAccountsPage()
</script>

<template>
  <div class="accounts-page">
    <AccountList
      v-if="showAccountList"
      :logins="logins"
      :is-loading="isLoading"
      :selected-username="selectedUsername"
      :is-selected="isSelected"
      :error-message="errorMessage"
      @select="handleSelect"
      @delete="handleDeleteAccount"
      @show-login="showLoginForm"
    />

    <CurrentAccount
      v-else-if="showCurrentAccount"
      :username="sessionUsername"
      @launch="handleLaunch"
      @show-login="showLoginForm"
      @go-to-accounts="goToAccounts"
    />

    <LaunchProgress
      v-else-if="showLaunchProgress"
      :progress="activeProgress"
      :steps="launchSteps"
      :error="loginError"
      @go-to-accounts="goToAccounts"
    />

    <AuthTabsWidget
      v-else-if="showAuthTabs"
      v-model:active-tab="activeSubTab"
      :show-back="showBack"
      @back="goToAccounts"
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
