<script setup lang="ts">
import { computed } from 'vue'
import { useProjectSettings, useAlternativeJava, useIntegrityCheck } from '@/04-features'
import { useCoreStore } from '@/05-entities'
import { PathPicker, AlternativeJavaButton, MemorySlider, ConfigCleanup, IntegrityCheck, JvmPreset, ServerConnect, ProjectDelete, SettingsSection, SettingsSaveBar, SettingsInfoRow } from '@/03-widgets'
import { Button, Checkbox, Input } from '@/06-shared'

const coreStore = useCoreStore()

const {
  config,
  isDirty,
  isLoading,
  loadError,
  maxMemoryLimit,
  isSaving,
  isClearingConfig,
  isRefreshingManifests,
  isDeleting,
  canDeleteProject,
  serverConnectUrl,
  isLoadingConnectUrl,
  selectJavaFolder,
  handleSave,
  handleClearMinecraftConfig,
  handleRefreshManifests,
  handleDeleteProject,
  handleGetConnectUrl,
  handleCopyConnectUrl,
  loadConfig,
  retryLoad,
} = useProjectSettings()

const {
  distributions,
  selectedDistribution,
  javaVersion,
  replaceDefault,
  isDownloading: isAltDownloading,
  isPopupOpen,
  isDistributionsLoading,
  distributionsError,
  versionError,
  openPopup,
  closePopup,
  startDownload,
} = useAlternativeJava()

const {
  steps: integritySteps,
  progress: integrityProgress,
  isChecking: isIntegrityChecking,
  isPopupHidden: isIntegrityPopupHidden,
  report: integrityReport,
  errorMessage: integrityError,
  handleCheck: handleIntegrityCheck,
  closeResult: closeIntegrityResult,
} = useIntegrityCheck()

const memoryRange = computed({
  get: () => config.value.memoryRange,
  set: (val: [number, number]) => { config.value.memoryRange = val },
})

const modLoaderLabels: Record<string, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

const handleOpenPopup = async (): Promise<void> => {
  await openPopup(config.value.mcVersion)
}

const handleDownload = async (): Promise<void> => {
  const replaced = await startDownload()
  if (replaced) {
    await loadConfig(coreStore.currentProject, true)
  }
}
</script>

<template>
  <div class="project-settings">
    <div v-if="loadError" class="project-settings__load-error" role="alert">
      <p class="project-settings__load-error-text">{{ loadError }}</p>
      <Button
        class="btn-secondary project-settings__load-error-btn"
        :is-loading="isLoading"
        :is-disabled="isLoading"
        @click="retryLoad"
      >
        Повторить
      </Button>
    </div>

    <SettingsSection title="Сборка" storage-key="project-build">
      <div class="settings-grid">
        <div class="project-settings__info">
          <SettingsInfoRow label="Версия Minecraft" :value="config.mcVersion" />
          <SettingsInfoRow label="Загрузчик модов" :value="modLoaderLabels[config.modLoader] ?? config.modLoader" />
        </div>

        <Input
          :model-value="config.loaderVersion"
          :options="{ label: 'Версия загрузчика', placeholder: 'Не указана' }"
          @update:model-value="config.loaderVersion = $event"
        />

        <Button
          class="btn-secondary project-settings__refresh-btn"
          :is-loading="isRefreshingManifests"
          :is-disabled="isRefreshingManifests || isSaving"
          @click="handleRefreshManifests"
        >
          Обновить списки версий
        </Button>

        <Checkbox
          class="project-settings__autojoin"
          :model-value="config.autoJoinServer"
          label="Автозаход на сервер при запуске"
          @update:model-value="config.autoJoinServer = $event"
        />
      </div>
    </SettingsSection>

    <SettingsSection title="Запуск" storage-key="project-run">
      <div class="settings-grid">
        <MemorySlider v-model="memoryRange" :max="maxMemoryLimit" />

        <JvmPreset class="settings-row" :config="config" />

        <Input
          class="settings-row"
          :model-value="config.jvmArgs"
          :options="{ label: 'JVM аргументы', placeholder: '-XX:+UseG1GC, -XX:MaxGCPauseMillis=50' }"
          @update:model-value="config.jvmArgs = $event"
        />
      </div>
    </SettingsSection>

    <SettingsSection title="Java" storage-key="project-java">
      <div class="settings-grid">
        <PathPicker
          class="settings-row"
          label="Путь к Java"
          placeholder="Выберите папку"
          :model-value="config.javaPath"
          @browse="selectJavaFolder"
        />

        <AlternativeJavaButton
          :distributions="distributions"
          :is-downloading="isAltDownloading"
          :popup-visible="isPopupOpen"
          :is-distributions-loading="isDistributionsLoading"
          :distributions-error="distributionsError"
          :java-version="javaVersion"
          :version-error="versionError"
          v-model:selected-distribution="selectedDistribution"
          v-model:replace-default="replaceDefault"
          v-model:version-input="javaVersion"
          @open-popup="handleOpenPopup"
          @download="handleDownload"
          @retry="handleOpenPopup"
          @close-popup="closePopup"
        />
      </div>
    </SettingsSection>

    <SettingsSection v-if="config.online" title="Подключение к серверу" storage-key="project-connect">
      <ServerConnect
        :url="serverConnectUrl"
        :is-loading="isLoadingConnectUrl"
        @get="handleGetConnectUrl"
        @copy="handleCopyConnectUrl"
      />
    </SettingsSection>

    <SettingsSection title="Обслуживание" storage-key="project-maintenance">
      <IntegrityCheck
        :is-checking="isIntegrityChecking"
        :is-popup-hidden="isIntegrityPopupHidden"
        :steps="integritySteps"
        :progress="integrityProgress"
        :report="integrityReport"
        :error-message="integrityError"
        @check="handleIntegrityCheck"
        @close="closeIntegrityResult"
      />
    </SettingsSection>

    <SettingsSection title="Опасная зона" storage-key="project-danger">
      <div class="project-settings__danger">
        <ConfigCleanup :is-clearing="isClearingConfig" @clear="handleClearMinecraftConfig" />
        <ProjectDelete v-if="canDeleteProject" :is-deleting="isDeleting" @delete="handleDeleteProject" />
      </div>
    </SettingsSection>

    <SettingsSaveBar :is-saving="isSaving" :is-dirty="isDirty" :is-blocked="loadError !== ''" @save="handleSave" />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.project-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__load-error {
    @include mixins.load-error-row;
  }

  &__load-error-text {
    margin: 0;
  }

  &__load-error-btn {
    flex-shrink: 0;
  }

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

  &__danger {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
}
</style>
