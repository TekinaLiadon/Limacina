<script setup lang="ts">
import { computed } from 'vue'
import { useLauncherSettings } from '@/04-features'
import { PathPicker, ThemeSelector, AnimationToggle, LauncherUpdate, LauncherBehavior, SettingsSection, SettingsSaveBar, type LauncherBehaviorForm } from '@/03-widgets'
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

const behaviorForm = computed<LauncherBehaviorForm>({
  get: () => ({
    discordActivity: discordActivity.value,
    autoUpdate: autoUpdate.value,
    keepOldConfigs: keepOldConfigs.value,
    startWithSystem: startWithSystem.value,
    closeAfterLaunch: closeAfterLaunch.value,
    minimizeToTray: minimizeToTray.value,
    systemNotifications: systemNotifications.value,
    debugMode: debugMode.value,
    downloadSpeedLimit: downloadSpeedLimitInput.value,
  }),
  set: (value) => {
    discordActivity.value = value.discordActivity
    autoUpdate.value = value.autoUpdate
    keepOldConfigs.value = value.keepOldConfigs
    startWithSystem.value = value.startWithSystem
    closeAfterLaunch.value = value.closeAfterLaunch
    minimizeToTray.value = value.minimizeToTray
    systemNotifications.value = value.systemNotifications
    debugMode.value = value.debugMode
    downloadSpeedLimitInput.value = value.downloadSpeedLimit
  },
})
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

    <LauncherBehavior v-model:form="behaviorForm" />

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
