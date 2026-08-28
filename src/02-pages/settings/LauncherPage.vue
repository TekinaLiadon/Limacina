<script setup lang="ts">
import { useLauncherSettings } from "@/04-features";
import { LauncherPath, ThemeSelector } from "@/03-widgets";
import { Button } from "@/06-shared";

const { launcherPath, isSaving, selectLauncherFolder, handleSave } = useLauncherSettings()
</script>

<template>
  <div class="launcher-settings">
    <div class="launcher-settings__section">
      <div class="section-label">Расположение</div>
      <LauncherPath :launcher-path="launcherPath" @browse="selectLauncherFolder" />
    </div>

    <div class="launcher-settings__section">
      <div class="section-label">Внешний вид</div>
      <ThemeSelector />
    </div>

<!--    <LauncherToggle
        v-for="toggle in toggles"
        :key="toggle.key"
        v-model="settings[toggle.key]"
        :label="toggle.label"
    />-->

<!--
    <SpeedLimit v-model="settings.downloadSpeedLimit" />
-->

    <Button
        class="btn-primary btn-lg btn-block"
        :is-loading="isSaving"
        :is-disabled="isSaving"
        @click="handleSave"
    >
      Сохранить
    </Button>
  </div>
</template>

<style lang="scss">
.launcher-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }
}
</style>
