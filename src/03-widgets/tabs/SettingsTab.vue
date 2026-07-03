<script setup lang="ts">
import { computed, ref } from 'vue'
import { PushNotification } from '@/06-shared'
import { useProjectSettings } from '@/04-features'
import ProjectSettings from './settings/ProjectSettings.vue'
import LauncherSettings from './settings/LauncherSettings.vue'

type SettingsSubTab = 'project' | 'launcher'

const activeSubTab = ref<SettingsSubTab>('launcher')

const {
  config,
  isLoaded,
  maxMemoryLimit,
  isSaving,
  showNotification,
  selectJavaFolder,
  handleSave,
} = useProjectSettings()

const isProjectDisabled = computed((): boolean => {
  return !isLoaded.value || !config.value.initialized
})
</script>

<template>
  <div class="settings-tab">
    <PushNotification
      :visible="showNotification"
      message="Настройки сохранены"
      @update:visible="showNotification = $event"
    />
    <h2 class="settings-tab__title">Настройки</h2>

    <div class="settings-tab__tabs">
      <button
        class="settings-tab__tab"
        :class="{ 'settings-tab__tab--active': activeSubTab === 'launcher' }"
        @click="activeSubTab = 'launcher'"
      >
        Лаунчер
      </button>
      <button
        class="settings-tab__tab"
        :class="{ 'settings-tab__tab--active': activeSubTab === 'project' }"
        :disabled="isProjectDisabled"
        @click="activeSubTab = 'project'"
      >
        Проект
      </button>
    </div>

    <div v-if="activeSubTab === 'project'" class="settings-tab__config">
      <ProjectSettings
        :config="config"
        :max-memory-limit="maxMemoryLimit"
        :is-saving="isSaving"
        @browse-java="selectJavaFolder"
        @save="handleSave"
      />
    </div>

    <div v-if="activeSubTab === 'launcher'" class="settings-tab__config">
      <LauncherSettings />
    </div>
  </div>
</template>

<style lang="scss">
.settings-tab {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 40px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;

  &__title {
    font-size: 28px;
    font-weight: 700;
    color: var(--login-text-primary);
    margin: 0 0 24px 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &__tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 4px;
  }

  &__tab {
    flex: 1;
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--login-text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;

    &:hover:not(:disabled) {
      color: var(--login-text-primary);
    }

    &--active {
      background: rgba(255, 255, 255, 0.1);
      color: var(--login-text-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__config {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
</style>
