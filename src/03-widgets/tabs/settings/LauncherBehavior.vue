<script setup lang="ts">
import { Checkbox, Input } from '@/06-shared'

defineProps<{
  discordActivity: boolean
  autoUpdate: boolean
  keepOldConfigs: boolean
  startWithSystem: boolean
  closeAfterLaunch: boolean
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
  'update:systemNotifications': [value: boolean]
  'update:debugMode': [value: boolean]
  'update:downloadSpeedLimit': [value: string]
}>()
</script>

<template>
  <div class="launcher-behavior">
    <Checkbox
      :model-value="discordActivity"
      label="Показывать статус в Discord"
      @update:model-value="emit('update:discordActivity', $event)"
    />
    <Checkbox
      :model-value="autoUpdate"
      label="Обновлять лаунчер автоматически"
      @update:model-value="emit('update:autoUpdate', $event)"
    />
    <Checkbox
      :model-value="keepOldConfigs"
      label="Сохранять старые конфиги Minecraft"
      @update:model-value="emit('update:keepOldConfigs', $event)"
    />
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
      :model-value="systemNotifications"
      label="Системные уведомления при свёрнутом лаунчере"
      @update:model-value="emit('update:systemNotifications', $event)"
    />
    <Checkbox
      :model-value="debugMode"
      label="Показывать страницу отладки"
      @update:model-value="emit('update:debugMode', $event)"
    />
    <Input
      class="span-full"
      :model-value="downloadSpeedLimit"
      :options="{ label: 'Ограничение скорости скачивания (КБ/с)', placeholder: 'Без ограничений', type: 'number' }"
      :min="1"
      @update:model-value="emit('update:downloadSpeedLimit', $event)"
    />
  </div>
</template>

<style lang="scss">
.launcher-behavior {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--settings-column-width)), 1fr));
  gap: var(--element-gap);
  align-items: center;
  grid-column: 1 / -1;

  > .span-full {
    grid-column: 1 / -1;
    margin-top: var(--space-12);
    justify-self: center;
    width: 100%;
    max-width: var(--settings-row-width);
  }
}
</style>
