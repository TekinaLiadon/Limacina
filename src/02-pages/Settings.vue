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
    <h2 class="settings-page__title">Настройки</h2>

    <div class="settings-page__tabs">
      <Button
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-page__tab"
        :class="{ 'settings-page__tab--active': activeSubTab === tab.key }"
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
  padding: 40px;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 24px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 4px;
  }

  &__tab {
    flex: 1;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--login-text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
    }

    &--active {
      background: rgba(255, 255, 255, 0.1);
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
    gap: 20px;
  }
}
</style>
