<script setup lang="ts">
import { useLauncherSettings } from '@/04-features'
import { PathPicker, ThemeSelector, AnimationToggle, LauncherUpdate, LauncherBehavior, SettingsSection, SettingsSaveBar } from '@/03-widgets'
import { useCoreStore } from '@/05-entities'

const coreStore = useCoreStore()

const {
  launcherPath,
  discordActivity,
  autoUpdate,
  keepOldConfigs,
  startWithSystem,
  closeAfterLaunch,
  minimizeToTray,
  systemNotifications,
  debugMode,
  downloadSpeedLimitInput,
  isSaving,
  isDirty,
  selectLauncherFolder,
  handleSave,
} = useLauncherSettings()
</script>

<template>
  <div class="launcher-settings">
    <SettingsSection title="Расположение" storage-key="launcher-location">
      <div class="settings-grid">
        <PathPicker
          class="settings-row"
          label="Путь к лаунчеру"
          placeholder="Путь не установлен"
          :model-value="launcherPath"
          @browse="selectLauncherFolder"
        />
      </div>
    </SettingsSection>

    <LauncherBehavior
      :discord-activity="discordActivity"
      :auto-update="autoUpdate"
      :keep-old-configs="keepOldConfigs"
      :start-with-system="startWithSystem"
      :close-after-launch="closeAfterLaunch"
      :minimize-to-tray="minimizeToTray"
      :system-notifications="systemNotifications"
      :debug-mode="debugMode"
      :download-speed-limit="downloadSpeedLimitInput"
      @update:discord-activity="discordActivity = $event"
      @update:auto-update="autoUpdate = $event"
      @update:keep-old-configs="keepOldConfigs = $event"
      @update:start-with-system="startWithSystem = $event"
      @update:close-after-launch="closeAfterLaunch = $event"
      @update:minimize-to-tray="minimizeToTray = $event"
      @update:system-notifications="systemNotifications = $event"
      @update:debug-mode="debugMode = $event"
      @update:download-speed-limit="downloadSpeedLimitInput = $event"
    />

    <SettingsSection title="Внешний вид" storage-key="launcher-appearance">
      <AnimationToggle />
      <ThemeSelector />
    </SettingsSection>

    <SettingsSection v-if="!coreStore.offlineBuild" title="Обновление лаунчера" storage-key="launcher-update">
      <LauncherUpdate />
    </SettingsSection>

    <SettingsSaveBar :is-saving="isSaving" :is-dirty="isDirty" @save="handleSave" />
  </div>
</template>

<style lang="scss">
.launcher-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}
</style>
