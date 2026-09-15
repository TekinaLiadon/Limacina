<script setup lang="ts">
import { Button } from '@/06-shared'
import { useGameOptions } from '@/04-features'
import GraphicsOptions from './game/GraphicsOptions.vue'
import SoundOptions from './game/SoundOptions.vue'
import ChatOptions from './game/ChatOptions.vue'
import ResourcePacksOptions from './game/ResourcePacksOptions.vue'

const {
  options,
  isLoading,
  isSaving,
  isSavingGlobal,
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
      <p class="game-settings__hint">Настройки применяются к игре после сохранения</p>
      <Button
        v-if="hasGlobal"
        class="btn-secondary game-settings__import-btn"
        :is-disabled="isLoading"
        @click="handleImportGlobal"
      >
        Импортировать общие
      </Button>
    </div>

    <div class="settings-grid">
      <div class="section-label span-full">Графика</div>
      <GraphicsOptions class="span-full" :options="options" />
    </div>

    <div class="settings-grid">
      <div class="section-label span-full">Звук</div>
      <SoundOptions class="span-full" :options="options" />
    </div>

    <div class="settings-grid">
      <div class="section-label span-full">Чат</div>
      <ChatOptions class="span-full" :options="options" />
    </div>

    <div class="settings-grid">
      <div class="section-label span-full">Ресурспаки</div>
      <ResourcePacksOptions
        class="span-full"
        :options="options"
        :available-packs="availableResourcePacks"
      />
    </div>

    <div class="game-settings__actions">
      <Button
        class="btn-primary btn-lg game-settings__save"
        :is-loading="isSaving"
        :is-disabled="isSaving || isSavingGlobal"
        @click="handleSave"
      >
        Сохранить
      </Button>
      <Button
        class="btn-secondary btn-lg game-settings__save-global"
        :is-loading="isSavingGlobal"
        :is-disabled="isSaving || isSavingGlobal"
        @click="handleSaveGlobal"
      >
        Сохранить глобально
      </Button>
    </div>
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
    justify-content: center;
    gap: var(--space-12);
    flex-wrap: wrap;
  }

  &__hint {
    @include mixins.caption-hint;

    text-align: left;
  }

  &__actions {
    display: flex;
    justify-content: center;
    gap: var(--element-gap);
    flex-wrap: wrap;
  }

  &__save {
    min-width: 220px;
  }
}
</style>
