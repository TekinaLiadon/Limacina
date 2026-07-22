<script setup lang="ts">
import { useLauncherSettings } from "@/04-features";
import { LauncherPath, LauncherToggle, SpeedLimit } from "@/03-widgets";
import { Button } from "@/06-shared";

const { launcherPath, settings, isSaving, selectLauncherFolder, handleSave } = useLauncherSettings()

const toggles = [
  { key: 'discordActivity' as const, label: 'Показывать активность в Discord' },
  { key: 'keepOldConfigs' as const, label: 'Сохранять старые конфиги при перекачке' },
  { key: 'autoUpdate' as const, label: 'Автоматическое обновление лаунчера' },
  { key: 'systemNotifications' as const, label: 'Системные уведомления' },
  { key: 'debugMode' as const, label: 'Включить дебаг' },
  { key: 'startWithSystem' as const, label: 'Запускать лаунчер с системой' },
  { key: 'closeAfterLaunch' as const, label: 'Закрывать лаунчер после запуска игры' },
]
</script>

<template>
  <div class="launcher-settings">
    <LauncherPath :launcher-path="launcherPath" @browse="selectLauncherFolder" />

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
        class="btn-yellow launcher-settings__btn"
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
  gap: 20px;

  &__btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 8px;
  }
}
</style>