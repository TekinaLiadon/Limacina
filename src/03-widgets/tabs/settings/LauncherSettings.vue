<script setup lang="ts">
import { computed } from 'vue'
import { Button, Checkbox, Input, PushNotification } from '@/06-shared'
import { useLauncherSettings } from '@/04-features'

const { launcherPath, settings, isSaving, showNotification, selectLauncherFolder, handleSave } = useLauncherSettings()

const speedLimitValue = computed({
  get: (): string => {
    return settings.value.downloadSpeedLimit !== null
      ? String(settings.value.downloadSpeedLimit)
      : ''
  },
  set: (val: string): void => {
    const num = parseInt(val, 10)
    settings.value.downloadSpeedLimit = isNaN(num) || num <= 0 ? null : num
  },
})

const isSpeedLimitEnabled = computed({
  get: (): boolean => settings.value.downloadSpeedLimit !== null,
  set: (val: boolean): void => {
    settings.value.downloadSpeedLimit = val ? 0 : null
  },
})
</script>

<template>
  <div class="launcher-settings">
    <PushNotification
      :visible="showNotification"
      message="Настройки сохранены"
      @update:visible="showNotification = $event"
    />
    <div class="launcher-settings__field">
      <span class="launcher-settings__label">Путь к лаунчеру</span>
      <div class="launcher-settings__path-row">
        <Input
          :model-value="launcherPath"
          :options="{ placeholder: 'Путь не установлен', disabled: true }"
        />
        <Button class="btn-yellow launcher-settings__browse-btn" @click="selectLauncherFolder">
          Обзор
        </Button>
      </div>
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.discordActivity"
        label="Показывать активность в Discord"
      />
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.keepOldConfigs"
        label="Сохранять старые конфиги при перекачке"
      />
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="isSpeedLimitEnabled"
        label="Ограничение скорости скачивания"
      />
      <div v-if="isSpeedLimitEnabled" class="launcher-settings__speed-row">
        <Input
          v-model="speedLimitValue"
          :options="{ placeholder: '0' }"
        />
        <span class="launcher-settings__speed-unit">МБ/с</span>
      </div>
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.autoUpdate"
        label="Автоматическое обновление лаунчера"
      />
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.systemNotifications"
        label="Системные уведомления"
      />
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.debugMode"
        label="Включить дебаг"
      />
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.startWithSystem"
        label="Запускать лаунчер с системой"
      />
    </div>

    <div class="launcher-settings__field">
      <Checkbox
        v-model="settings.closeAfterLaunch"
        label="Закрывать лаунчер после запуска игры"
      />
    </div>

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

  &__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__label {
    font-size: 14px;
    color: var(--yellow);
    font-weight: 400;
  }

  &__path-row {
    display: flex;
    gap: 10px;
    align-items: flex-end;

    .input__core {
      flex: 1;
    }
  }

  &__browse-btn {
    height: 40px;
    padding: 0 20px;
    font-size: 13px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  &__speed-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;

    .input__core {
      max-width: 120px;
    }
  }

  &__speed-unit {
    font-size: 14px;
    color: var(--login-text-muted);
    white-space: nowrap;
  }

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
