<script setup>
import DashboardWrapper from "@/03-widgets/dashboard/DashboardWrapper.vue";
import Preloader from "@/01-app/preloader/Preloader.vue";
import {useCoreStore} from "@/05-entities/core/coreStore.js";
import {onBeforeMount} from "vue";
import init from "@/01-app/init.js";
import {invoke} from "@tauri-apps/api/core";

const coreStore = useCoreStore()

onBeforeMount(async () => {
  init()
  try {
    await invoke('load_settings_project', {
      projectName: "libra"
    })
  } catch (e){
    await invoke('save_settings_project', {
      config: {
        projectName: "libra",
        mcVersion: "1.21.1",
        modLoader: "fabric",
        loaderVersion: "0.19.2",
        jvmArgs: [],
        minMemory: "-Xms512M",
        maxMemory: "-Xmx4G",
      }
    })
  }
})
</script>

<template>
  <main class="app">
    <transition name="fade">
      <Preloader v-if="coreStore.isLoading"/>
      <div v-else>
        <router-view/>
        <slot/>
      </div>
    </transition>
    <!--<DashboardWrapper v-else>-->
  </main>
</template>

<style lang="scss">
@use "@/01-app/assets/main.scss";

.app {
  height: 100%;
}
</style>
