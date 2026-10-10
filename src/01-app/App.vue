<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PushNotification, ConfirmPopup, Dropdown, Preloader } from '@/06-shared'
import { useCoreStore, useNotificationStore, type TabKey } from '@/05-entities'
import { useAppInit, useTheme, useProjectSwitch, useConsoleStream, useLaunchStepsStream, useSystemNotifications, useServerStatus, useServerAvailability, useGameSession, useCpmProjectOpen, useSettingsNav, useAppNavigation } from '@/04-features'
import { Sidebar, ServerStatus, ServerUnavailableBanner, StartupError, ThemeModeToggle, ThemeSwitchAnimation } from '@/03-widgets'

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()
const { preloaderText, startupError, retryInit } = useAppInit()
const notificationStore = useNotificationStore()

const { isSwitching, switchDirection } = useTheme()
const { projectOptions, canSwitch, isSwitching: isProjectSwitching, selectProject } = useProjectSwitch()
const { startConsoleStream } = useConsoleStream()
void startConsoleStream()
const { startLaunchStepsStream } = useLaunchStepsStream()
void startLaunchStepsStream()
const { startSystemNotifications } = useSystemNotifications()
void startSystemNotifications()
const { startServerStatusSync } = useServerStatus()
void startServerStatusSync()
const { startServerAvailabilitySync } = useServerAvailability()
void startServerAvailabilitySync()
const { startGameSessionSync } = useGameSession()
void startGameSessionSync()
useCpmProjectOpen()
const { isDebugTabVisible } = useAppNavigation()

interface Tab {
  key: TabKey
  name: string
}

const tabs = computed((): Tab[] => {
  const items: Tab[] = [
    { key: 'accounts', name: 'Accounts' },
    { key: 'add-profile', name: 'AddProfile' },
    { key: 'mods', name: 'Mods' },
    { key: 'settings', name: 'SettingsLauncher' },
  ]
  if (isDebugTabVisible.value) {
    items.push({ key: 'debug', name: 'Debug' })
  }
  return items
})

const { items: settingsNavItems } = useSettingsNav()

const settingsRouteNames = computed((): string[] => settingsNavItems.value.map((item) => item.routeName))

const fullscreenRouteNames: string[] = ['Setup']

const showLayout = computed((): boolean => !fullscreenRouteNames.includes(route.name as string))

const currentTab = computed((): TabKey => {
  const name = route.name as string
  if (settingsRouteNames.value.includes(name)) return 'settings'

  const tab = tabs.value.find((t) => t.name === name)
  return tab?.key ?? 'accounts'
})

const navigateTo = (key: TabKey): void => {
  const tab = tabs.value.find((t) => t.key === key)
  if (tab) router.push({ name: tab.name })
}

const goSetupFromError = (): void => {
  startupError.value = ''
  router.replace({ name: 'Setup' })
}
</script>

<template>
  <main class="app">
    <ThemeSwitchAnimation :visible="isSwitching" :direction="switchDirection" />
    <PushNotification
      :visible="notificationStore.visible"
      :message="notificationStore.message"
    />
    <ConfirmPopup
      :visible="notificationStore.popupVisible"
      :message="notificationStore.popupMessage"
      @confirm="notificationStore.resolvePopup(true)"
      @cancel="notificationStore.resolvePopup(false)"
    />
    <transition name="fade">
      <Preloader v-if="coreStore.isLoading" :text="preloaderText" />
      <StartupError
        v-else-if="startupError"
        :message="startupError"
        :show-setup="!coreStore.hasLauncherConfig"
        @retry="retryInit"
        @setup="goSetupFromError"
      />
      <template v-else>
        <div v-if="showLayout" class="app__layout">
          <div class="app__header">
            <div class="app__project" v-if="coreStore.projects.length > 0">
              <Dropdown
                :options="projectOptions"
                :model-value="coreStore.currentProject"
                @update:model-value="selectProject"
                width="var(--header-project-width)"
                :max-visible="6"
                :disabled="!canSwitch || isProjectSwitching"
              >
                <template #trailing>
                  <ServerStatus />
                </template>
              </Dropdown>
            </div>
            <ThemeModeToggle variant="icons" />
          </div>

          <div class="app__body">
            <Sidebar
              :active-tab="currentTab"
              :settings-sub-tab="route.name as string"
              :show-debug="isDebugTabVisible"
              :show-mods="coreStore.isOfflineProject"
              @navigate="navigateTo"
              @navigate-settings="(routeName: string) => router.push({ name: routeName })"
            />

            <div class="app__content">
              <div class="app__content-inner">
                <ServerUnavailableBanner />
                <router-view v-slot="{ Component }">
                  <Transition name="page" mode="out-in">
                    <component :is="Component" />
                  </Transition>
                </router-view>
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
@use '@/01-app/assets/mixins';

.app {
  height: 100%;

  &__version {
    @include mixins.eyebrow($line-height: null, $transform: none, $weight: null);

    position: fixed;
    top: var(--space-4);
    right: var(--space-8);
    font-family: var(--font-eyebrow);
    font-variant-numeric: tabular-nums;
    z-index: var(--z-version);
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
      @include mixins.grid-backdrop(radial-gradient(ellipse at 50% 0%, black 0%, transparent 80%));

      z-index: var(--z-background);
    }
  }

  &__header {
    position: relative;
    z-index: var(--z-header);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: var(--space-12);
  }

  &__project {
    min-width: var(--sidebar-width);
  }

  &__body {
    position: relative;
    z-index: var(--z-content);
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
