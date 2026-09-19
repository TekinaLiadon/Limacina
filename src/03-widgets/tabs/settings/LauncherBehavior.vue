<script setup lang="ts">
import { Checkbox, Input } from '@/06-shared'
import SettingsSection from './SettingsSection.vue'

defineProps<{
  discordActivity: boolean
  autoUpdate: boolean
  keepOldConfigs: boolean
  startWithSystem: boolean
  closeAfterLaunch: boolean
  minimizeToTray: boolean
  systemNotifications: boolean
  debugMode: boolean
  downloadSpeedLimit: string
}>()

const emit = defineEmits<{
  'update:discordActivity': [value: boolean]
  'update:autoUpdate': [value: boolean]
  'update:keepOldConfigs': [value: boolean]
  'update:startWithSystem': [value: boolean]
  'update:closeAfterLaunch': [value: boolean]
  'update:minimizeToTray': [value: boolean]
  'update:systemNotifications': [value: boolean]
  'update:debugMode': [value: boolean]
  'update:downloadSpeedLimit': [value: string]
}>()
</script>

<template>
  <SettingsSection title="Запуск и закрытие" storage-key="launcher-run">
    <div class="settings-grid">
      <Checkbox
        :model-value="startWithSystem"
        label="Запускать лаунчер при старте системы"
        @update:model-value="emit('update:startWithSystem', $event)"
      />
      <Checkbox
        :model-value="closeAfterLaunch"
        label="Закрывать лаунчер после запуска игры"
        @update:model-value="emit('update:closeAfterLaunch', $event)"
      />
      <Checkbox
        :model-value="minimizeToTray"
        label="Сворачивать в трей при закрытии"
        @update:model-value="emit('update:minimizeToTray', $event)"
      />
    </div>
  </SettingsSection>

  <SettingsSection title="Уведомления" storage-key="launcher-notifications">
    <div class="settings-grid">
      <Checkbox
        :model-value="systemNotifications"
        label="Системные уведомления при свёрнутом лаунчере"
        @update:model-value="emit('update:systemNotifications', $event)"
      />
      <Checkbox
        :model-value="discordActivity"
        label="Показывать статус в Discord"
        @update:model-value="emit('update:discordActivity', $event)"
      />
    </div>
  </SettingsSection>

  <SettingsSection title="Загрузка и обновление" storage-key="launcher-downloads">
    <div class="settings-grid">
      <Checkbox
        :model-value="autoUpdate"
        label="Обновлять лаунчер автоматически"
        @update:model-value="emit('update:autoUpdate', $event)"
      />
      <Input
        class="launcher-behavior__speed span-full"
        :model-value="downloadSpeedLimit"
        :options="{ label: 'Ограничение скорости скачивания (КБ/с)', placeholder: 'Без ограничений', type: 'number' }"
        :min="1"
        @update:model-value="emit('update:downloadSpeedLimit', $event)"
      />
    </div>
  </SettingsSection>

  <SettingsSection title="Продвинутое" storage-key="launcher-advanced">
    <div class="settings-grid">
      <Checkbox
        :model-value="keepOldConfigs"
        label="Сохранять старые конфиги Minecraft"
        @update:model-value="emit('update:keepOldConfigs', $event)"
      />
      <Checkbox
        :model-value="debugMode"
        label="Показывать страницу отладки"
        @update:model-value="emit('update:debugMode', $event)"
      />
    </div>
  </SettingsSection>
</template>

<style lang="scss">
.launcher-behavior__speed {
  width: 100%;
  max-width: var(--settings-row-width);
}
</style>
