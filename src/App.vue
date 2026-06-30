<script setup>
import Preloader from "@/01-app/preloader/Preloader.vue";
import { useCoreStore } from "@/05-entities/core/coreStore.js";
import { onBeforeMount, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useRouter } from "vue-router";

const coreStore = useCoreStore();
const router = useRouter();
const preloaderText = ref("");

onBeforeMount(async () => {
  const startTime = Date.now();
  try {
    const initData = await invoke("get_app_init_data");
    coreStore.launcherName = initData.launcherName;
    coreStore.defaultParentPath = initData.defaultParentPath;
    coreStore.launcherConfig = initData.launcherConfig;
    coreStore.hasLauncherConfig = !!initData.launcherConfig;
    coreStore.version = initData.version;

    preloaderText.value = "Проверка обновлений...";
    const updateInfo = await invoke("check_update");
    if (updateInfo) {
      preloaderText.value = `Скачивание обновления до v${updateInfo.version}...`;
      try {
        await invoke("apply_update_cmd");
      } catch (e) {
        console.error("Ошибка применения обновления:", e);
      }

      preloaderText.value = "Обновление завершено, загрузка...";
      const freshData = await invoke("get_app_init_data");
      coreStore.version = freshData.version;
      coreStore.launcherConfig = freshData.launcherConfig;
      coreStore.hasLauncherConfig = !!freshData.launcherConfig;
    }

    if (!coreStore.launcherConfig) {
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
    console.error("Ошибка инициализации:", e);
  } finally {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 2000 - elapsed);
    setTimeout(() => {
      coreStore.isLoading = false;
    }, remaining);
  }
});
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
@use "@/01-app/assets/main.scss";

.app {
  height: 100%;

  &__version {
    position: fixed;
    bottom: 12px;
    right: 16px;
    font-size: 12px;
    color: var(--grey-text-db);
    opacity: 0.6;
  }
}
</style>
