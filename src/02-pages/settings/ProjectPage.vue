<script setup lang="ts">
import { computed } from 'vue'
import { useProjectSettings, useAlternativeJava } from '@/04-features'
import { useCoreStore } from '@/05-entities'
import { ProjectInfoFields, JavaPathPicker, AlternativeJavaButton, MemorySlider } from '@/03-widgets'
import { Button } from '@/06-shared'

const coreStore = useCoreStore()

const {
  config,
  maxMemoryLimit,
  isSaving,
  selectJavaFolder,
  handleSave,
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
    await loadConfig(coreStore.currentProject)
  }
}
</script>

<template>
  <div class="project-settings">
    <ProjectInfoFields :config="config" />
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

    <Button
      class="btn-yellow project-settings__btn"
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
  gap: 20px;

  &__btn {
    width: 100%;
    height: 48px;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-top: 8px;
  }
}
</style>
