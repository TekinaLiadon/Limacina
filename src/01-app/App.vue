<script setup lang="ts">
import Preloader from '@/01-app/preloader/Preloader.vue'
import { useCoreStore } from '@/05-entities'
import { onBeforeMount, ref } from 'vue'
import { getAppInitData, checkUpdate, applyUpdateCmd, loadSettingsProject, saveSettingsProject } from '@/06-shared/api'
import { useRouter } from 'vue-router'
import type { ProjectConfig } from '@/05-entities/core/types'

const coreStore = useCoreStore()
const router = useRouter()
const preloaderText = ref<string>('')

const defaultProjectConfig: ProjectConfig = {
  projectName: 'Cordelia',
  mcVersion: '1.21.1',
  modLoader: 'neoforge',
  loaderVersion: null,
  javaPath: null,
  jvmArgs: [],
  minMemory: '-Xms512M',
  maxMemory: '-Xmx4G',
  initialized: false,
}

onBeforeMount(async () => {
  const startTime: number = Date.now()
  try {
    const initData = await getAppInitData()
    coreStore.launcherName = initData.launcherName
    coreStore.defaultParentPath = initData.defaultParentPath
    coreStore.launcherConfig = initData.launcherConfig
    coreStore.hasLauncherConfig = !!initData.launcherConfig
    coreStore.version = initData.version
    coreStore.totalMemoryMb = initData.totalMemoryMb

    preloaderText.value = 'Проверка обновлений...'
    const updateInfo = await checkUpdate()
    if (updateInfo) {
      preloaderText.value = `Скачивание обновления до v${updateInfo.version}...`
      try {
        await applyUpdateCmd()
      } catch (e: unknown) {
        console.error('Ошибка применения обновления:', e)
      }

      preloaderText.value = 'Обновление завершено, загрузка...'
      const freshData = await getAppInitData()
      coreStore.version = freshData.version
      coreStore.launcherConfig = freshData.launcherConfig
      coreStore.hasLauncherConfig = !!freshData.launcherConfig
    }

    if (!coreStore.launcherConfig) {
      router.replace('/setup')
    } else {
      try {
        await loadSettingsProject('Cordelia')
      } catch (e: unknown) {
        await saveSettingsProject(defaultProjectConfig)
      }
    }
  } catch (e: unknown) {
    console.error('Ошибка инициализации:', e)
  } finally {
    const elapsed: number = Date.now() - startTime
    const remaining: number = Math.max(0, 2000 - elapsed)
    setTimeout(() => {
      coreStore.isLoading = false
    }, remaining)
  }
})
</script>

<template>
  <main class="app">
    <transition name="fade">
      <Preloader v-if="coreStore.isLoading" :text="preloaderText" />
      <div v-else>
        <router-view />
        <slot />
        <div v-if="coreStore.version" class="app__version">v{{ coreStore.version }}</div>
      </div>
    </transition>
  </main>
</template>

<style lang="scss">
@use '@/01-app/assets/main.scss';

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
}
</style>
