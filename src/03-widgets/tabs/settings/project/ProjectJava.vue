<script setup lang="ts">
import { useAlternativeJava } from '@/04-features'
import SettingsSection from '../SettingsSection.vue'
import PathPicker from '../PathPicker.vue'
import AlternativeJavaButton from '../AlternativeJavaButton.vue'

const props = defineProps<{
  javaPath: string
  mcVersion: string
}>()

const emit = defineEmits<{
  browse: []
  'java-replaced': []
}>()

const {
  distributions,
  selectedDistribution,
  javaVersion,
  replaceDefault,
  isDownloading,
  isPopupOpen,
  isDistributionsLoading,
  distributionsError,
  versionError,
  openPopup,
  closePopup,
  startDownload,
} = useAlternativeJava()

const handleOpenPopup = async (): Promise<void> => {
  await openPopup(props.mcVersion)
}

const handleDownload = async (): Promise<void> => {
  const result = await startDownload()
  if (result === 'replaced') emit('java-replaced')
}
</script>

<template>
  <SettingsSection title="Java" storage-key="project-java">
    <div class="settings-grid">
      <PathPicker
        class="settings-row"
        label="Путь к Java"
        placeholder="Выберите папку"
        :model-value="javaPath"
        @browse="emit('browse')"
      />

      <AlternativeJavaButton
        class="settings-row project-java__alt-java"
        :distributions="distributions"
        :is-downloading="isDownloading"
        :popup-visible="isPopupOpen"
        :is-distributions-loading="isDistributionsLoading"
        :distributions-error="distributionsError"
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
</template>

<style lang="scss">
.project-java {
  &__alt-java {
    align-self: end;
  }
}
</style>
