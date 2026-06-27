<script setup>
import Preloader from "@/01-app/preloader/Preloader.vue";
import { useCoreStore } from "@/05-entities/core/coreStore.js";
import { onBeforeMount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "vue-router";

const coreStore = useCoreStore();
const router = useRouter();

onBeforeMount(async () => {
  try {
    const initData = await invoke("get_app_init_data");
    coreStore.launcherName = initData.launcherName;
    coreStore.defaultParentPath = initData.defaultParentPath;
    coreStore.launcherConfig = initData.launcherConfig;
    coreStore.hasLauncherConfig = !!initData.launcherConfig;

    if (!initData.launcherConfig) {
      router.replace("/setup");
    } else {
      try {
        await invoke("load_settings_project", { projectName: "Cordelia" });
      } catch (e) {
        await invoke("save_settings_project", {
          config: {
            projectName: "Cordelia",
            mcVersion: "1.21.1",
            modLoader: "neoforge",
            jvmArgs: [],
            minMemory: "-Xms512M",
            maxMemory: "-Xmx4G",
          },
        });
      }
    }
  } catch (e) {
    console.error("Ошибка проверки конфига:", e);
  } finally {
    coreStore.isLoading = false;
  }
});
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
