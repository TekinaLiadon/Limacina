<script setup lang="ts">
import Preloader from '@/01-app/preloader/Preloader.vue'
import { useCoreStore } from '@/05-entities'
import { useAppInit } from './useAppInit'

const coreStore = useCoreStore()
const { preloaderText } = useAppInit()
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
