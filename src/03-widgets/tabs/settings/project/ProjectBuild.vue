<script setup lang="ts">
import { Button, Checkbox, Input } from '@/06-shared'
import { LOADER_LABELS, type ModLoaderKind } from '@/05-entities'
import SettingsSection from '../SettingsSection.vue'
import SettingsInfoRow from '../SettingsInfoRow.vue'

defineProps<{
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string
  autoJoinServer: boolean
  isRefreshing: boolean
  isSaving: boolean
}>()

const emit = defineEmits<{
  'update:loaderVersion': [value: string]
  'update:autoJoinServer': [value: boolean]
  refresh: []
}>()
</script>

<template>
  <SettingsSection title="Сборка" storage-key="project-build">
    <div class="settings-grid">
      <div class="project-build__info">
        <SettingsInfoRow label="Версия Minecraft" :value="mcVersion" />
        <SettingsInfoRow label="Загрузчик модов" :value="LOADER_LABELS[modLoader]" />
      </div>

      <Input
        :model-value="loaderVersion"
        :options="{ label: 'Версия загрузчика', placeholder: 'Не указана' }"
        @update:model-value="emit('update:loaderVersion', $event)"
      />

      <Button
        class="btn-secondary project-build__refresh-btn"
        :is-loading="isRefreshing"
        :is-disabled="isRefreshing || isSaving"
        @click="emit('refresh')"
      >
        Обновить списки версий
      </Button>

      <Checkbox
        class="project-build__autojoin"
        :model-value="autoJoinServer"
        label="Автозаход на сервер при запуске"
        @update:model-value="emit('update:autoJoinServer', $event)"
      />
    </div>
  </SettingsSection>
</template>

<style lang="scss">
.project-build {
  &__info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
  }

  &__refresh-btn {
    align-self: start;
    width: 100%;
    max-width: var(--settings-row-width);
  }

  &__autojoin {
    align-self: center;
  }
}
</style>
