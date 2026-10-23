<script setup lang="ts">
import { Checkbox, Input } from '@/06-shared'
import SettingsSection from './SettingsSection.vue'
import type { LauncherBehaviorForm } from '@/05-entities'

defineProps<{
  form: LauncherBehaviorForm
  speedLimitError: string
}>()

const emit = defineEmits<{
  'update:form': [value: LauncherBehaviorForm]
}>()
</script>

<template>
  <SettingsSection title="Запуск и закрытие" storage-key="launcher-run">
    <div class="settings-grid">
      <Checkbox
        :model-value="form.startWithSystem"
        label="Запускать лаунчер при старте системы"
        @update:model-value="emit('update:form', { ...form, startWithSystem: $event })"
      />
      <Checkbox
        :model-value="form.closeAfterLaunch"
        label="Закрывать лаунчер после запуска игры"
        @update:model-value="emit('update:form', { ...form, closeAfterLaunch: $event })"
      />
      <Checkbox
        :model-value="form.minimizeToTray"
        label="Сворачивать в трей при закрытии"
        @update:model-value="emit('update:form', { ...form, minimizeToTray: $event })"
      />
    </div>
  </SettingsSection>

  <SettingsSection title="Уведомления" storage-key="launcher-notifications">
    <div class="settings-grid">
      <Checkbox
        :model-value="form.systemNotifications"
        label="Системные уведомления при свёрнутом лаунчере"
        @update:model-value="emit('update:form', { ...form, systemNotifications: $event })"
      />
      <Checkbox
        :model-value="form.discordActivity"
        label="Показывать статус в Discord"
        @update:model-value="emit('update:form', { ...form, discordActivity: $event })"
      />
    </div>
  </SettingsSection>

  <SettingsSection title="Загрузка и обновление" storage-key="launcher-downloads">
    <div class="settings-grid">
      <Checkbox
        :model-value="form.autoUpdate"
        label="Обновлять лаунчер автоматически"
        @update:model-value="emit('update:form', { ...form, autoUpdate: $event })"
      />
      <div class="launcher-behavior__speed span-full">
        <Input
          :class="{ 'launcher-behavior__speed-input--invalid': speedLimitError !== '' }"
          :model-value="form.downloadSpeedLimit"
          :options="{ label: 'Ограничение скорости скачивания (КБ/с)', placeholder: 'Без ограничений', type: 'number' }"
          :min="1"
          :aria-invalid="speedLimitError !== '' ? 'true' : undefined"
          @update:model-value="emit('update:form', { ...form, downloadSpeedLimit: $event })"
        />
        <p v-if="speedLimitError" class="launcher-behavior__speed-error">{{ speedLimitError }}</p>
      </div>
    </div>
  </SettingsSection>

  <SettingsSection title="Продвинутое" storage-key="launcher-advanced">
    <div class="settings-grid">
      <Checkbox
        :model-value="form.keepOldConfigs"
        label="Сохранять старые конфиги Minecraft"
        @update:model-value="emit('update:form', { ...form, keepOldConfigs: $event })"
      />
      <Checkbox
        :model-value="form.debugMode"
        label="Показывать страницу отладки"
        @update:model-value="emit('update:form', { ...form, debugMode: $event })"
      />
    </div>
  </SettingsSection>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.launcher-behavior__speed {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: 100%;
  max-width: var(--settings-row-width);
}

.launcher-behavior__speed-input--invalid .input__text {
  box-shadow: inset 0 0 0 1px var(--error-border);
}

.launcher-behavior__speed-error {
  @include mixins.error-box;

  margin: 0;
}
</style>
