<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Preloader from '@/01-app/preloader/Preloader.vue'
import { PushNotification, ConfirmPopup, Dropdown } from '@/06-shared'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { useAppInit } from '@/04-features'
import { Sidebar } from '@/03-widgets'
import type { DropdownOption } from '@/06-shared/types'
import type { TabKey } from '@/05-entities/core/types'

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()
const { preloaderText } = useAppInit()
const notificationStore = useNotificationStore()

interface Tab {
  key: TabKey
  name: string
}

const tabs: Tab[] = [
  { key: 'accounts', name: 'Accounts' },
  { key: 'add-server', name: 'AddServer' },
  { key: 'settings', name: 'SettingsLauncher' },
  { key: 'debug', name: 'Debug' },
]

const settingsRouteNames: string[] = ['SettingsLauncher', 'SettingsProject', 'SettingsSkin', 'SettingsModel']

const showLayout = computed((): boolean => route.name !== 'Setup')

const currentTab = computed((): TabKey => {
  const name = route.name as string
  if (settingsRouteNames.includes(name)) return 'settings'

  const tab = tabs.find((t) => t.name === name)
  return tab?.key ?? 'accounts'
})

const projectOptions = computed((): DropdownOption[] => {
  return coreStore.projects.map((p) => ({ title: p, value: p }))
})

const navigateTo = (key: TabKey): void => {
  const tab = tabs.find((t) => t.key === key)
  if (tab) router.push({ name: tab.name })
}
</script>

<template>
  <main class="app">
    <PushNotification
      :visible="notificationStore.visible"
      :message="notificationStore.message"
      @update:visible="notificationStore.hide"
    />
    <ConfirmPopup
      :visible="notificationStore.popupVisible"
      :message="notificationStore.popupMessage"
      @confirm="notificationStore.resolvePopup(true)"
      @cancel="notificationStore.resolvePopup(false)"
    />
    <transition name="fade">
      <Preloader v-if="coreStore.isLoading" :text="preloaderText" />
      <template v-else>
        <div v-if="showLayout" class="app__layout">
          <div class="app__header">
            <div class="app__project">
              <Dropdown
                :options="projectOptions"
                v-model="coreStore.currentProject"
                :width="'220px'"
                :disabled="true"
              />
            </div>
          </div>

          <div class="app__body">
            <Sidebar :active-tab="currentTab" @navigate="navigateTo" />

            <div class="app__content">
              <div class="app__content-inner">
                <router-view />
              </div>
            </div>
          </div>
        </div>
        <router-view v-else />
      </template>
    </transition>
    <div v-if="coreStore.version" class="app__version">v{{ coreStore.version }}</div>
  </main>
</template>

<style lang="scss">
@use '@/01-app/assets/main.scss';
@use '@/01-app/assets/breakpoints';

.app {
  height: 100%;

  &__version {
    position: fixed;
    bottom: 4px;
    left: 8px;
    font-size: 12px;
    color: #ffffff;
    -webkit-text-stroke: 1px #000;
    paint-order: stroke fill;
    z-index: 1000;
  }

  &__layout {
    height: 100vh;
    width: 100%;
    background: var(--app-bg);
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    overflow: hidden;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  &__project {
    min-width: 220px;
  }

  &__body {
    flex: 1;
    display: flex;
    gap: 24px;
    min-height: 0;
  }

  &__content {
    flex: 1;
    min-height: 0;
    background: var(--login-bg-form);
    border: 1px solid var(--login-border);
    border-radius: 16px;
    overflow-y: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__content-inner {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  @include breakpoints.media-under-lg {
    &__layout {
      padding: 16px;
      padding-bottom: 100px;
    }

    &__header {
      justify-content: center;
    }

    &__body {
      flex-direction: column;
    }
  }
}
</style>
