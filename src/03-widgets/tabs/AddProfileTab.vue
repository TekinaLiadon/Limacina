<script setup lang="ts">
import { computed } from 'vue'
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

const kindHint = computed((): string =>
  kind.value === 'server'
    ? 'Подключение по адресу — версия, сборка и моды загрузятся с сервера автоматически'
    : 'Локальный профиль без сети: сами выбираете версию и загрузчик модов',
)

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

    <div class="add-profile-tab__switch" role="tablist">
      <Button
        v-for="tab in kindTabs"
        :key="tab.key"
        class="add-profile-tab__kind"
        :class="{ 'add-profile-tab__kind--active': kind === tab.key }"
        role="tab"
        :aria-selected="kind === tab.key"
        @click="selectKind(tab.key)"
      >
        {{ tab.label }}
      </Button>
    </div>

    <p class="add-profile-tab__hint">{{ kindHint }}</p>

    <div class="add-profile-tab__form">
      <ServerProfileForm
        v-if="kind === 'server'"
        :form="serverForm"
        :is-submitting="isSubmitting"
        :is-valid="isServerValid"
        :error-message="errorMessage"
        :can-go-back="canGoBack"
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
        @submit="handleOfflineSubmit"
        @back="handleBack"
      />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.add-profile-tab {
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: var(--page-padding-y) var(--page-padding-x);
  display: flex;
  flex-direction: column;
  height: 100%;

  &__title {
    margin-bottom: var(--title-gap);
  }

  &__switch {
    @include mixins.segmented;

    margin-bottom: var(--space-12);
  }

  &__kind {
    flex: 1 1 0;
    min-width: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    box-shadow: none;
    color: var(--login-text-muted);
    white-space: normal;
    overflow-wrap: anywhere;

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      @include mixins.segmented-active;
    }

    &.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__hint {
    @include mixins.caption-hint;

    margin-bottom: var(--tabs-gap);
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
