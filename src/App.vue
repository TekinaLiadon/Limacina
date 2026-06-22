<script setup>
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
      projectName: "Cordelia"
    })
  } catch (e){
    await invoke('save_settings_project', {
      config: {
        projectName: "Cordelia",
        mcVersion: "1.21.1", // "1.16.5"
        modLoader: "neoforge", // "forge",
        //loaderVersion: "36.2.42",
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
  </main>
</template>

<style lang="scss">
@use "@/01-app/assets/main.scss";

.app {
  height: 100%;
}
</style>
