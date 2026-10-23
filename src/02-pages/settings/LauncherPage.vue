<script setup lang="ts">
import { useLauncherSettings } from '@/04-features'
import { PathPicker, ThemeSelector, AnimationToggle, LauncherUpdate, LauncherBehavior, SettingsSection, SettingsPageShell } from '@/03-widgets'
import { useCoreStore } from '@/05-entities'

const coreStore = useCoreStore()

const {
  behaviorForm,
  launcherPath,
  downloadSpeedLimitError,
  isLoading,
  loadError,
  isSaving,
  isDirty,
  selectLauncherFolder,
  handleSave,
  retryLoad,
} = useLauncherSettings()
</script>

<template>
  <SettingsPageShell
    :is-loading="isLoading"
    :load-error="loadError"
    :is-saving="isSaving"
    :is-dirty="isDirty"
    @retry="retryLoad"
    @save="handleSave"
  >
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

    <LauncherBehavior v-model:form="behaviorForm" :speed-limit-error="downloadSpeedLimitError" />

    <SettingsSection title="Внешний вид" storage-key="launcher-appearance">
      <AnimationToggle />
      <ThemeSelector />
    </SettingsSection>

    <SettingsSection v-if="coreStore.isServerBuild" title="Обновление лаунчера" storage-key="launcher-update">
      <LauncherUpdate />
    </SettingsSection>
  </SettingsPageShell>
</template>
