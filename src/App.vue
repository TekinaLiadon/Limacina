<script setup>
import DashboardWrapper from "@/03-widgets/dashboard/DashboardWrapper.vue";
import Preloader from "@/01-app/preloader/Preloader.vue";
import {useCoreStore} from "@/05-entities/core/coreStore.js";
import {onBeforeMount} from "vue";
import init from "@/01-app/init.js";
const coreStore = useCoreStore()

onBeforeMount(() => init())
</script>

<template>
  <main class="app">
    <transition name="fade">
    <Preloader v-if="coreStore.isLoading" />
    <DashboardWrapper v-else>
      <router-view />
      <slot />
    </DashboardWrapper>
    </transition>
  </main>
</template>

<style lang="scss">
@use "@/01-app/assets/main.scss";
.app {
  height: 100%;
}
</style>
