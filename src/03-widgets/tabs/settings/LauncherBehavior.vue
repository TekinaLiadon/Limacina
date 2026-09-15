<script setup lang="ts">
import { Checkbox, Input } from '@/06-shared'

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
  <div class="launcher-behavior">
    <span class="launcher-behavior__subhead">Запуск и закрытие</span>
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

    <span class="launcher-behavior__subhead">Уведомления</span>
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

    <span class="launcher-behavior__subhead">Загрузка и обновление</span>
    <Checkbox
      :model-value="autoUpdate"
      label="Обновлять лаунчер автоматически"
      @update:model-value="emit('update:autoUpdate', $event)"
    />
    <Input
      class="launcher-behavior__speed"
      :model-value="downloadSpeedLimit"
      :options="{ label: 'Ограничение скорости скачивания (КБ/с)', placeholder: 'Без ограничений', type: 'number' }"
      :min="1"
      @update:model-value="emit('update:downloadSpeedLimit', $event)"
    />

    <span class="launcher-behavior__subhead">Продвинутое</span>
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
</template>

<style lang="scss">
.launcher-behavior {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--settings-column-width-wide)), 1fr));
  gap: var(--element-gap);
  align-items: center;
  align-content: start;

  &__subhead {
    grid-column: 1 / -1;
    margin-top: var(--space-8);
    font-family: var(--font-eyebrow);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--login-text-muted);
    font-feature-settings: "tnum" on;
  }

  &__speed {
    grid-column: 1 / -1;
    width: 100%;
    max-width: var(--settings-row-width);
  }
}
</style>
