<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Preloader from '@/01-app/preloader/Preloader.vue'
import { PushNotification, ConfirmPopup, Dropdown } from '@/06-shared'
import { useCoreStore, useNotificationStore, useSettingsStore } from '@/05-entities'
import { useAppInit, useTheme, ThemeSwitchAnimation } from '@/04-features'
import { Sidebar } from '@/03-widgets'
import type { DropdownOption } from '@/06-shared/types'
import type { TabKey } from '@/05-entities/core/types'

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()
const settingsStore = useSettingsStore()
const { preloaderText } = useAppInit()
const notificationStore = useNotificationStore()

const { isSwitching, switchDirection } = useTheme()

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
    <ThemeSwitchAnimation :visible="isSwitching" :direction="switchDirection" />
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
            <div class="app__project" v-if="coreStore.projects.length > 0">
              <Dropdown
                :options="projectOptions"
                v-model="coreStore.currentProject"
                :width="'220px'"
                :disabled="true"
              />
            </div>
            <button class="app__theme-toggle" :class="{ 'app__theme-toggle--disabled': isSwitching }" @click="settingsStore.toggleDarkLight" :disabled="isSwitching" :title="settingsStore.isDark ? 'Светлая тема' : 'Тёмная тема'">
              <span class="app__theme-icon" :class="{ 'app__theme-icon--light': !settingsStore.isDark }">
                <svg v-if="settingsStore.isDark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </span>
            </button>
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
    color: var(--white);
    -webkit-text-stroke: 1px var(--black);
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
    gap: 12px;
  }

  &__project {
    min-width: 220px;
  }

  &__theme-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 1px solid var(--login-border);
    background: var(--surface-input);
    color: var(--login-text-primary);
    cursor: pointer;
    transition: all 0.3s ease;
    flex-shrink: 0;

    &:hover:not(&--disabled) {
      background: var(--surface-hover);
      border-color: var(--login-accent);
      transform: scale(1.05);
    }

    &:active:not(&--disabled) {
      transform: scale(0.95);
    }

    &--disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }
  }

  &__theme-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.3s ease;

    &--light {
      color: var(--yellow);
    }
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
