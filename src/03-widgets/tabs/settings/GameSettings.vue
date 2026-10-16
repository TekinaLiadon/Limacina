<script setup lang="ts">
import { Button } from '@/06-shared'
import { useGameOptions } from '@/04-features'
import SettingsPageShell from './SettingsPageShell.vue'
import SettingsSection from './SettingsSection.vue'
import GameOptionsFields from './game/GameOptionsFields.vue'
import ResourcePacksOptions from './game/ResourcePacksOptions.vue'
import GameOptionsSkeleton from './game/GameOptionsSkeleton.vue'
import { chatOptionFields, graphicsOptionFields, soundOptionFields } from './game/options'

const gameSections = [
  { title: 'Графика', storageKey: 'game-graphics', fields: graphicsOptionFields },
  { title: 'Звук', storageKey: 'game-sound', fields: soundOptionFields },
  { title: 'Чат', storageKey: 'game-chat', fields: chatOptionFields },
]

const {
  options,
  isLoading,
  loadError,
  isSaving,
  isSavingGlobal,
  isDirty,
  hasGlobal,
  versionReady,
  availableResourcePacks,
  handleImportGlobal,
  handleSave,
  handleSaveGlobal,
  retryLoad,
} = useGameOptions()
</script>

<template>
  <SettingsPageShell
    :is-loading="isLoading"
    :load-error="loadError"
    :is-saving="isSaving"
    :is-dirty="isDirty"
    @retry="retryLoad"
    @save="handleSave"
  >
    <template #head>
      <div class="game-settings__head">
        <p class="game-settings__hint">
          Настройки сохраняются в options.txt проекта и применяются при следующем
          запуске игры. Ресурспаки можно выбрать до старта.
        </p>
        <p v-if="!versionReady && !isLoading" class="game-settings__hint">
          Игра ещё не установлена: настройки запомнятся в лаунчере и впишутся в
          options.txt при установке.
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
    </template>

    <template #loading>
      <SettingsSection
        v-for="section in gameSections"
        :key="section.storageKey"
        :title="section.title"
        :storage-key="section.storageKey"
      >
        <GameOptionsSkeleton />
      </SettingsSection>
      <SettingsSection title="Ресурспаки" storage-key="game-packs">
        <GameOptionsSkeleton />
      </SettingsSection>
    </template>

    <SettingsSection
      v-for="section in gameSections"
      :key="section.storageKey"
      :title="section.title"
      :storage-key="section.storageKey"
    >
      <GameOptionsFields :fields="section.fields" :options="options" @update:options="options = $event" />
    </SettingsSection>

    <SettingsSection title="Ресурспаки" storage-key="game-packs">
      <ResourcePacksOptions
        :options="options"
        :available-packs="availableResourcePacks"
        :is-loading="isLoading"
        @update:options="options = $event"
      />
    </SettingsSection>

    <template #save-extra>
      <Button
        class="btn-secondary btn-lg game-settings__save-global"
        :is-loading="isSavingGlobal || isLoading"
        :is-disabled="isSaving || isSavingGlobal || isLoading || loadError !== ''"
        @click="handleSaveGlobal"
      >
        Сохранить глобально
      </Button>
    </template>
  </SettingsPageShell>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-settings {
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
