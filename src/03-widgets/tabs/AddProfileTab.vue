<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/06-shared'
import { useAddProfile } from '@/04-features'
import ServerProfileForm from '@/03-widgets/tabs/profile/ServerProfileForm.vue'
import OfflineProfileForm from '@/03-widgets/tabs/profile/OfflineProfileForm.vue'
import type { ProfileKind, ProjectConfig } from '@/05-entities'

const props = defineProps<{
  embedded?: boolean
}>()

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
  submitServer,
  submitOffline,
} = useAddProfile()

const kindTabs: Array<{ key: ProfileKind; label: string }> = [
  { key: 'server', label: 'Сервер' },
  { key: 'offline', label: 'Одиночная игра' },
]

const moveKind = (delta: number): void => {
  const count = kindTabs.length
  const currentIndex = kindTabs.findIndex((tab) => tab.key === kind.value)
  const nextTab = kindTabs[(currentIndex + delta + count) % count]
  if (!nextTab) return
  selectKind(nextTab.key)
  void nextTick((): void => {
    document.getElementById(`add-profile-kind-${nextTab.key}`)?.focus({ preventScroll: true })
  })
}

const handleKindKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveKind(1)
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveKind(-1)
  }
}

const canGoBack = computed((): boolean => !(props.embedded ?? false))

const goToAccounts = (config: ProjectConfig | null): void => {
  if (config) router.push({ name: 'Accounts' })
}

const handleBack = (): void => {
  router.push({ name: 'Accounts' })
}

const handleServerSubmit = async (): Promise<void> => {
  goToAccounts(await submitServer())
}

const handleOfflineSubmit = async (): Promise<void> => {
  goToAccounts(await submitOffline())
}
</script>

<template>
  <div class="add-profile-tab" :class="{ 'add-profile-tab--embedded': props.embedded ?? false }">
    <h2 v-if="!(props.embedded ?? false)" class="add-profile-tab__title heading-display">Добавить профиль</h2>

    <div class="add-profile-tab__switch" role="tablist" aria-label="Тип профиля" @keydown="handleKindKeydown">
      <Button
        v-for="tab in kindTabs"
        :id="`add-profile-kind-${tab.key}`"
        :key="tab.key"
        class="add-profile-tab__kind"
        :class="{ 'add-profile-tab__kind--active': kind === tab.key }"
        role="tab"
        :aria-selected="kind === tab.key"
        :tabindex="kind === tab.key ? 0 : -1"
        aria-controls="add-profile-kind-panel"
        @click="selectKind(tab.key)"
      >
        {{ tab.label }}
      </Button>
    </div>

    <div
      id="add-profile-kind-panel"
      role="tabpanel"
      class="add-profile-tab__form"
      :aria-labelledby="`add-profile-kind-${kind}`"
    >
      <ServerProfileForm
        v-if="kind === 'server'"
        :form="serverForm"
        :is-submitting="isSubmitting"
        :is-valid="isServerValid"
        :error-message="errorMessage"
        :can-go-back="canGoBack"
        @update:form="serverForm = $event"
        @submit="handleServerSubmit"
        @back="handleBack"
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
        :can-go-back="canGoBack"
        @update:form="offlineForm = $event"
        @submit="handleOfflineSubmit"
        @back="handleBack"
      />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.add-profile-tab {
  @include mixins.page-scaffold;

  &__title {
    margin-bottom: var(--title-gap);
  }

  &__switch {
    @include mixins.segmented;

    margin-bottom: var(--space-12);
  }

  &__kind {
    @include mixins.segmented-item($disabled-opacity: 0.4);

    flex: 1 1 0;
    min-width: 0;
    box-shadow: none;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  &__form {
    width: 100%;
  }

  &--embedded {
    max-width: none;
    margin: 0;
    padding: 0;
    height: auto;
  }
}
</style>
