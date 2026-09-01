<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAddProfile } from '@/04-features'
import ProfileKindChoice from '@/03-widgets/tabs/profile/ProfileKindChoice.vue'
import ServerProfileForm from '@/03-widgets/tabs/profile/ServerProfileForm.vue'
import OfflineProfileForm from '@/03-widgets/tabs/profile/OfflineProfileForm.vue'
import type { ProjectConfig } from '@/05-entities/core/types'

const router = useRouter()

const {
  kind,
  isSubmitting,
  errorMessage,
  serverForm,
  offlineForm,
  mcVersionOptions,
  loaderOptions,
  loaderVersionOptions,
  needsLoaderVersion,
  isLoadingMcVersions,
  isLoadingLoaderVersions,
  isServerValid,
  isOfflineValid,
  selectKind,
  goBack,
  submitServer,
  submitOffline,
} = useAddProfile()

const goToAccounts = (config: ProjectConfig | null): void => {
  if (config) router.push({ name: 'Accounts' })
}

const handleServerSubmit = async (): Promise<void> => {
  goToAccounts(await submitServer())
}

const handleOfflineSubmit = async (): Promise<void> => {
  goToAccounts(await submitOffline())
}
</script>

<template>
  <div class="add-profile-tab">
    <ProfileKindChoice v-if="kind === null" @select="selectKind" />

    <ServerProfileForm
      v-else-if="kind === 'server'"
      :form="serverForm"
      :is-submitting="isSubmitting"
      :is-valid="isServerValid"
      :error-message="errorMessage"
      @submit="handleServerSubmit"
      @back="goBack"
    />

    <OfflineProfileForm
      v-else
      :form="offlineForm"
      :mc-version-options="mcVersionOptions"
      :loader-options="loaderOptions"
      :loader-version-options="loaderVersionOptions"
      :needs-loader-version="needsLoaderVersion"
      :is-loading-mc-versions="isLoadingMcVersions"
      :is-loading-loader-versions="isLoadingLoaderVersions"
      :is-submitting="isSubmitting"
      :is-valid="isOfflineValid"
      :error-message="errorMessage"
      @submit="handleOfflineSubmit"
      @back="goBack"
    />
  </div>
</template>

<style lang="scss">
.add-profile-tab {
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: var(--page-padding-y) var(--page-padding-x);
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
