<script setup lang="ts">
import { Button } from '@/06-shared'
import { useGameOptions } from '@/04-features'
import { SettingsSection, SettingsSaveBar } from '@/03-widgets'
import GraphicsOptions from './game/GraphicsOptions.vue'
import SoundOptions from './game/SoundOptions.vue'
import ChatOptions from './game/ChatOptions.vue'
import ResourcePacksOptions from './game/ResourcePacksOptions.vue'

const {
  options,
  isLoading,
  isSaving,
  isSavingGlobal,
  isDirty,
  hasGlobal,
  availableResourcePacks,
  handleImportGlobal,
  handleSave,
  handleSaveGlobal,
} = useGameOptions()
</script>

<template>
  <div class="game-settings">
    <div class="game-settings__head">
      <p class="game-settings__hint">
        Настройки применяются после сохранения — лаунчер вписывает их в
        options.txt проекта при запуске
      </p>
      <Button
        v-if="hasGlobal"
        class="btn-secondary game-settings__import-btn"
        :is-disabled="isLoading"
        @click="handleImportGlobal"
      >
        Импортировать общие
      </Button>
    </div>

    <SettingsSection title="Графика" storage-key="game-graphics">
      <GraphicsOptions :options="options" />
    </SettingsSection>

    <SettingsSection title="Звук" storage-key="game-sound">
      <SoundOptions :options="options" />
    </SettingsSection>

    <SettingsSection title="Чат" storage-key="game-chat">
      <ChatOptions :options="options" />
    </SettingsSection>

    <SettingsSection title="Ресурспаки" storage-key="game-packs">
      <ResourcePacksOptions
        :options="options"
        :available-packs="availableResourcePacks"
        :is-loading="isLoading"
      />
    </SettingsSection>

    <SettingsSaveBar :is-saving="isSaving" :is-dirty="isDirty" @save="handleSave">
      <template #extra>
        <Button
          class="btn-secondary btn-lg game-settings__save-global"
          :is-loading="isSavingGlobal"
          :is-disabled="isSaving || isSavingGlobal"
          @click="handleSaveGlobal"
        >
          Сохранить глобально
        </Button>
      </template>
    </SettingsSaveBar>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-16);
  }

  &__hint {
    @include mixins.caption-hint;

    text-align: left;
  }
}
</style>
