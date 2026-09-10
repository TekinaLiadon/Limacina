<script setup lang="ts">
import { useLauncherSettings } from "@/04-features";
import { LauncherPath, ThemeSelector, LauncherUpdate, LauncherBehavior } from "@/03-widgets";
import { Button } from "@/06-shared";

const {
  launcherPath,
  discordActivity,
  autoUpdate,
  keepOldConfigs,
  startWithSystem,
  closeAfterLaunch,
  systemNotifications,
  debugMode,
  downloadSpeedLimitInput,
  isSaving,
  selectLauncherFolder,
  handleSave,
} = useLauncherSettings()
</script>

<template>
  <div class="launcher-settings">
    <div class="settings-grid">
      <div class="section-label span-full">Расположение</div>
      <LauncherPath class="span-full settings-row" :launcher-path="launcherPath" @browse="selectLauncherFolder" />
    </div>

    <div class="settings-grid">
      <div class="section-label span-full">Поведение</div>
      <LauncherBehavior
        :discord-activity="discordActivity"
        :auto-update="autoUpdate"
        :keep-old-configs="keepOldConfigs"
        :start-with-system="startWithSystem"
        :close-after-launch="closeAfterLaunch"
        :system-notifications="systemNotifications"
        :debug-mode="debugMode"
        :download-speed-limit="downloadSpeedLimitInput"
        @update:discord-activity="discordActivity = $event"
        @update:auto-update="autoUpdate = $event"
        @update:keep-old-configs="keepOldConfigs = $event"
        @update:start-with-system="startWithSystem = $event"
        @update:close-after-launch="closeAfterLaunch = $event"
        @update:system-notifications="systemNotifications = $event"
        @update:debug-mode="debugMode = $event"
        @update:download-speed-limit="downloadSpeedLimitInput = $event"
      />
    </div>

    <Button
        class="btn-primary btn-lg launcher-settings__save"
        :is-loading="isSaving"
        :is-disabled="isSaving"
        @click="handleSave"
    >
      Сохранить
    </Button>

    <LauncherUpdate class="settings-row" />

    <div class="settings-grid">
      <div class="section-label span-full">Внешний вид</div>
      <ThemeSelector class="span-full" />
    </div>
  </div>
</template>

<style lang="scss">
.launcher-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__save {
    align-self: center;
    min-width: 220px;
  }
}
</style>
