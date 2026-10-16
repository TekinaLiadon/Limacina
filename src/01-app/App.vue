<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PushNotification, ConfirmPopup, Preloader } from '@/06-shared'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { useAppInit, useTheme, useConsoleStream, useLaunchStepsStream, useSystemNotifications, useServerStatus, useServerAvailability, useGameSession, useCpmProjectOpen, useAppNavigation } from '@/04-features'
import { StartupError, ThemeSwitchAnimation } from '@/03-widgets'
import AppLayout from '@/01-app/AppLayout.vue'

const router = useRouter()
const route = useRoute()
const coreStore = useCoreStore()
const { preloaderText, startupError, retryInit } = useAppInit()
const notificationStore = useNotificationStore()

const { isSwitching, switchDirection } = useTheme()
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

const fullscreenRouteNames: string[] = ['Setup']

const showLayout = computed((): boolean => !fullscreenRouteNames.includes(route.name as string))

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
      <AppLayout v-else-if="showLayout" :show-debug="isDebugTabVisible" />
      <router-view v-else />
    </transition>
    <div v-if="coreStore.version" class="app__version">v{{ coreStore.version }}</div>
  </main>
</template>

<style lang="scss">
@use '@/01-app/assets/main.scss';
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
}
</style>
