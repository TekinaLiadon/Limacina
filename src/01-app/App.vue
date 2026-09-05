<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Preloader from '@/01-app/preloader/Preloader.vue'
import { PushNotification, ConfirmPopup, Dropdown } from '@/06-shared'
import { useCoreStore, useNotificationStore, useSettingsStore } from '@/05-entities'
import { useAppInit, useTheme, useProjectSwitch, ThemeSwitchAnimation, useConsoleStream, useLaunchStepsStream, useSystemNotifications } from '@/04-features'
import { Sidebar } from '@/03-widgets'
import type { TabKey } from '@/05-entities/core/types'

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()
const settingsStore = useSettingsStore()
const { preloaderText } = useAppInit()
const notificationStore = useNotificationStore()

const { isSwitching, switchDirection } = useTheme()
const { projectOptions, canSwitch, selectProject } = useProjectSwitch()
const { startConsoleStream } = useConsoleStream()
void startConsoleStream()
const { startLaunchStepsStream } = useLaunchStepsStream()
void startLaunchStepsStream()
const { startSystemNotifications } = useSystemNotifications()
void startSystemNotifications()

interface Tab {
  key: TabKey
  name: string
}

const isDebugTabVisible = computed((): boolean => coreStore.launcherConfig?.debugMode ?? false)

const tabs = computed((): Tab[] => {
  const items: Tab[] = [
    { key: 'accounts', name: 'Accounts' },
    { key: 'add-profile', name: 'AddProfile' },
    { key: 'settings', name: 'SettingsLauncher' },
  ]
  if (isDebugTabVisible.value) {
    items.push({ key: 'debug', name: 'Debug' })
  }
  return items
})

const settingsRouteNames: string[] = ['SettingsLauncher', 'SettingsProject', 'SettingsSkin', 'SettingsModel', 'SettingsAccount']

const showLayout = computed((): boolean => route.name !== 'Setup')

const currentTab = computed((): TabKey => {
  const name = route.name as string
  if (settingsRouteNames.includes(name)) return 'settings'

  const tab = tabs.value.find((t) => t.name === name)
  return tab?.key ?? 'accounts'
})

const navigateTo = (key: TabKey): void => {
  const tab = tabs.value.find((t) => t.key === key)
  if (tab) router.push({ name: tab.name })
}

watch(isDebugTabVisible, (visible: boolean): void => {
  if (!visible && route.name === 'Debug') {
    router.push({ name: 'Accounts' })
  }
})
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
                :model-value="coreStore.currentProject"
                @update:model-value="selectProject"
                :width="'220px'"
                :max-visible="6"
                :disabled="!canSwitch"
              />
            </div>
            <div class="app__theme-switch" role="group" aria-label="Тема оформления">
              <button
                class="app__theme-segment"
                :class="{ 'app__theme-segment--active': settingsStore.isDark }"
                :disabled="isSwitching"
                :aria-pressed="settingsStore.isDark"
                aria-label="Тёмная тема"
                title="Тёмная тема"
                @click="settingsStore.setThemeMode('dark')"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </button>
              <button
                class="app__theme-segment"
                :class="{ 'app__theme-segment--active': !settingsStore.isDark }"
                :disabled="isSwitching"
                :aria-pressed="!settingsStore.isDark"
                aria-label="Светлая тема"
                title="Светлая тема"
                @click="settingsStore.setThemeMode('light')"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
              </button>
            </div>
          </div>

          <div class="app__body">
            <Sidebar :active-tab="currentTab" :show-debug="isDebugTabVisible" @navigate="navigateTo" />

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
    font-family: var(--font-eyebrow);
    font-size: var(--text-caption);
    letter-spacing: var(--tracking-eyebrow);
    color: var(--login-text-muted);
    font-variant-numeric: tabular-nums;
    z-index: 1000;
  }

  &__layout {
    position: relative;
    height: 100vh;
    width: 100%;
    background: var(--app-bg);
    display: flex;
    flex-direction: column;
    gap: var(--layout-gap);
    padding: var(--layout-padding);
    overflow: hidden;

    &::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
        linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
      background-size: 80px 80px;
      mask-image: radial-gradient(ellipse at 50% 0%, black 0%, transparent 80%);
      -webkit-mask-image: radial-gradient(ellipse at 50% 0%, black 0%, transparent 80%);
      pointer-events: none;
      z-index: 0;
    }
  }

  &__header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: var(--space-12);
  }

  &__project {
    min-width: var(--sidebar-width);
  }

  &__theme-switch {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    flex-shrink: 0;
  }

  &__theme-segment {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    border: none;
    border-radius: var(--radius-circle);
    background: transparent;
    color: var(--login-text-muted);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;

    &:hover:not(:disabled) {
      color: var(--login-text-primary);
    }

    &--active {
      background: var(--surface-active);
      box-shadow: var(--elevation-inset);
      color: var(--login-text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__body {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    gap: var(--layout-gap);
    min-height: 0;
  }

  &__content {
    flex: 1;
    min-height: 0;
    background: var(--login-bg-form);
    border-radius: var(--radius-card);
    box-shadow: var(--elevation-card);
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
      --layout-padding: var(--space-16);
      --layout-gap: var(--space-16);
    }

    &__header {
      justify-content: center;
    }

    &__body {
      flex-direction: column-reverse;
    }
  }
}
</style>
