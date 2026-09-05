<script setup lang="ts">
import { computed } from 'vue'
import { useProjectSettings, useAlternativeJava, useIntegrityCheck } from '@/04-features'
import { useCoreStore } from '@/05-entities'
import { ProjectInfoFields, JavaPathPicker, AlternativeJavaButton, MemorySlider, ConfigCleanup, IntegrityCheck } from '@/03-widgets'
import { Button } from '@/06-shared'

const coreStore = useCoreStore()

const {
  config,
  maxMemoryLimit,
  isSaving,
  isClearingConfig,
  isRefreshingManifests,
  selectJavaFolder,
  handleSave,
  handleClearMinecraftConfig,
  handleRefreshManifests,
  loadConfig,
} = useProjectSettings()

const {
  distributions,
  selectedDistribution,
  javaVersion,
  replaceDefault,
  isDownloading: isAltDownloading,
  isPopupOpen,
  openPopup,
  closePopup,
  startDownload,
} = useAlternativeJava()

const {
  steps: integritySteps,
  progress: integrityProgress,
  isChecking: isIntegrityChecking,
  report: integrityReport,
  errorMessage: integrityError,
  handleCheck: handleIntegrityCheck,
  closeResult: closeIntegrityResult,
} = useIntegrityCheck()

const memoryRange = computed({
  get: () => config.value.memoryRange,
  set: (val: [number, number]) => { config.value.memoryRange = val },
})

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
    <div class="project-settings__section">
      <div class="section-label">Профиль сборки</div>
      <ProjectInfoFields :config="config" />
      <Button
        class="btn-secondary btn-block"
        :is-loading="isRefreshingManifests"
        :is-disabled="isRefreshingManifests || isSaving"
        @click="handleRefreshManifests"
      >
        Обновить списки версий
      </Button>
    </div>

    <div class="project-settings__section">
      <div class="section-label">Java</div>
      <JavaPathPicker :java-path="config.javaPath" @browse="selectJavaFolder" />
      <AlternativeJavaButton
        :distributions="distributions"
        :is-downloading="isAltDownloading"
        :popup-visible="isPopupOpen"
        :java-version="javaVersion"
        v-model:selected-distribution="selectedDistribution"
        v-model:replace-default="replaceDefault"
        v-model:version-input="javaVersion"
        @open-popup="handleOpenPopup"
        @download="handleDownload"
        @close-popup="closePopup"
      />
      <MemorySlider v-model="memoryRange" :max="maxMemoryLimit" />
    </div>

    <div class="project-settings__section">
      <div class="section-label">Конфиги игры</div>
      <ConfigCleanup :is-clearing="isClearingConfig" @clear="handleClearMinecraftConfig" />
      <IntegrityCheck
        :is-checking="isIntegrityChecking"
        :steps="integritySteps"
        :progress="integrityProgress"
        :report="integrityReport"
        :error-message="integrityError"
        @check="handleIntegrityCheck"
        @close="closeIntegrityResult"
      />
    </div>

    <Button
      class="btn-primary btn-lg btn-block"
      :is-loading="isSaving"
      :is-disabled="isSaving"
      @click="handleSave"
    >
      Сохранить
    </Button>
  </div>
</template>

<style lang="scss">
.project-settings {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__section {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }
}
</style>
