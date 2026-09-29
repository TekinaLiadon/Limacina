<script setup lang="ts">
import { Button } from '@/06-shared'
import { useGameOptions } from '@/04-features'
import LoadErrorRow from '../../common/LoadErrorRow.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsSaveBar from './SettingsSaveBar.vue'
import GraphicsOptions from './game/GraphicsOptions.vue'
import SoundOptions from './game/SoundOptions.vue'
import ChatOptions from './game/ChatOptions.vue'
import ResourcePacksOptions from './game/ResourcePacksOptions.vue'
import GameOptionsSkeleton from './game/GameOptionsSkeleton.vue'

const {
  options,
  isLoading,
  loadError,
  isSaving,
  isSavingGlobal,
  isDirty,
  hasGlobal,
  availableResourcePacks,
  handleImportGlobal,
  handleSave,
  handleSaveGlobal,
  retryLoad,
} = useGameOptions()
</script>

<template>
  <div class="game-settings">
    <LoadErrorRow :message="loadError" :is-loading="isLoading" @retry="retryLoad" />

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
      <GameOptionsSkeleton v-if="isLoading" />
      <GraphicsOptions v-else :options="options" @update:options="options = $event" />
    </SettingsSection>

    <SettingsSection title="Звук" storage-key="game-sound">
      <GameOptionsSkeleton v-if="isLoading" />
      <SoundOptions v-else :options="options" @update:options="options = $event" />
    </SettingsSection>

    <SettingsSection title="Чат" storage-key="game-chat">
      <GameOptionsSkeleton v-if="isLoading" />
      <ChatOptions v-else :options="options" @update:options="options = $event" />
    </SettingsSection>

    <SettingsSection title="Ресурспаки" storage-key="game-packs">
      <ResourcePacksOptions
        :options="options"
        :available-packs="availableResourcePacks"
        :is-loading="isLoading"
        @update:options="options = $event"
      />
    </SettingsSection>

    <SettingsSaveBar
      :is-saving="isSaving"
      :is-loading="isLoading"
      :is-dirty="isDirty"
      :is-blocked="loadError !== ''"
      @save="handleSave"
    >
      <template #extra>
        <Button
          class="btn-secondary btn-lg game-settings__save-global"
          :is-loading="isSavingGlobal || isLoading"
          :is-disabled="isSaving || isSavingGlobal || isLoading || loadError !== ''"
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
