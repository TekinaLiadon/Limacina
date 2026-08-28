<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Button } from '@/06-shared'
import { useCoreStore } from '@/05-entities'
import { useProjectSettings } from '@/04-features'

type SettingsSubTab = 'project' | 'launcher' | 'skin' | 'model'

interface Tab {
  key: SettingsSubTab
  label: string
  name: string
  needsInit?: boolean
  needsAuth?: boolean
}

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()

const tabs: Tab[] = [
  { key: 'launcher', label: 'Лаунчер', name: 'SettingsLauncher' },
  { key: 'project', label: 'Проект', name: 'SettingsProject', needsInit: true },
  { key: 'skin', label: 'Скин', name: 'SettingsSkin', needsInit: true, needsAuth: true },
  { key: 'model', label: 'Модель', name: 'SettingsModel', needsInit: true, needsAuth: true },
]

const { config, isLoaded } = useProjectSettings()

const activeSubTab = computed((): SettingsSubTab => {
  const result = tabs.find((el) => el.name === route.name)

  if (!result) return 'launcher'
  return result.key
})

const isProjectDisabled = computed((): boolean => {
  return !isLoaded.value || !config.value.initialized
})

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
        :is-disabled="(tab.needsInit && isProjectDisabled) || (tab.needsAuth && !coreStore.isLoggedIn)"
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
.settings-page {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: var(--space-40) var(--space-32);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 0;

  &__title {
    margin-bottom: var(--space-24);
  }

  &__tabs {
    display: flex;
    gap: var(--space-4);
    margin-bottom: var(--space-32);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-pill);
    padding: var(--space-4);
  }

  &__tab {
    flex: 1;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--login-text-muted);

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
}
</style>
