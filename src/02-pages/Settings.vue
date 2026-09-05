<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Button } from '@/06-shared'
import { useCoreStore } from '@/05-entities'
import { useProjectSettings } from '@/04-features'

type SettingsSubTab = 'project' | 'launcher' | 'skin' | 'model' | 'account'

interface Tab {
  key: SettingsSubTab
  label: string
  name: string
  needsInit?: boolean
  needsAuth?: boolean
  needsOnline?: boolean
}

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()

const tabs: Tab[] = [
  { key: 'launcher', label: 'Лаунчер', name: 'SettingsLauncher' },
  { key: 'project', label: 'Проект', name: 'SettingsProject', needsInit: true },
  { key: 'account', label: 'Аккаунт', name: 'SettingsAccount', needsInit: true, needsAuth: true, needsOnline: true },
  { key: 'skin', label: 'Скин', name: 'SettingsSkin', needsInit: true, needsAuth: true, needsOnline: true },
  { key: 'model', label: 'Модель', name: 'SettingsModel', needsInit: true, needsAuth: true, needsOnline: true },
]

const { config, isLoaded } = useProjectSettings()

const activeSubTab = computed((): SettingsSubTab => {
  const result = tabs.find((el) => el.name === route.name)

  if (!result) return 'launcher'
  return result.key
})

const isProjectDisabled = computed((): boolean => {
  return !isLoaded.value || !(coreStore.projectConfig?.initialized ?? config.value.initialized)
})

const isOfflineProject = computed((): boolean => isLoaded.value && !config.value.online)

const isTabDisabled = (tab: Tab): boolean => {
  if (tab.needsInit && isProjectDisabled.value) return true
  if (tab.needsAuth && !coreStore.isLoggedIn) return true
  if (tab.needsOnline && isOfflineProject.value) return true
  return false
}

</script>

<template>
  <div class="settings-page">
    <h2 class="settings-page__title heading-display">Настройки</h2>

    <div class="settings-page__tabs" role="tablist">
      <Button
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-page__tab"
        :class="{ 'settings-page__tab--active': activeSubTab === tab.key }"
        role="tab"
        :aria-selected="activeSubTab === tab.key"
        :is-disabled="isTabDisabled(tab)"
        @click="router.push({ name: tab.name })"
      >
        {{ tab.label }}
      </Button>
    </div>

    <div class="settings-page__content">
      <router-view />
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/breakpoints';

.settings-page {
  width: 100%;
  max-width: var(--page-max-width);
  margin: 0 auto;
  padding: var(--page-padding-y) var(--page-padding-x);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 0;

  &__title {
    margin-bottom: var(--title-gap);
  }

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
    flex: 1 1 0;
    min-width: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--login-text-muted);
    white-space: normal;
    overflow-wrap: anywhere;

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
      background: var(--surface-light);
    }

    &--active {
      background: var(--surface-active);
      box-shadow: var(--elevation-inset);
      color: var(--login-text-primary);
    }

    &.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__content {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  @include breakpoints.media-under-lg {
    &__tabs {
      gap: var(--space-4);
    }

    &__tab {
      padding: var(--space-4) var(--space-8);
      font-size: var(--text-caption);
    }
  }

  @include breakpoints.media-under-sm {
    &__tabs {
      padding: var(--space-4);
    }
  }
}
</style>
