<script setup lang="ts">
import { computed } from 'vue'
import { Checkbox } from '@/06-shared'
import {
  useCpmSettings,
  useCpmAnimations,
  useOfflineCpmModel,
} from '@/04-features'
import CpmAnimationPanel from './CpmAnimationPanel.vue'
import CpmTabbedPanel from './CpmTabbedPanel.vue'
import type { CpmTabbedPanelData } from './cpmTabbedPanel'
import CpmViewer from './CpmViewer.vue'
import UserContentViewer from './UserContentViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  cpmData,
  cpmFileBytes,
  modelName,
  errorMessage,
  showEmptyLayers,
  activeLayerIds,
  layerPanelData,
  visibleLayerKeys,
  setVisibleLayerKeys,
  setTextureError,
  isUploading,
  isOffline,
  uploadedModels,
  isListLoading,
  listError,
  loadList,
  isDragOver,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
} = useCpmSettings()

const { isSaving, handleSaveModelOffline } = useOfflineCpmModel({
  cpmFileBytes,
  cpmData,
  modelName,
  errorMessage,
})

const {
  animationGroups,
  selectedAnimationIds,
  activeAnimations,
  isAnimationPlaying,
  isAnimationLooped,
  animationSpeed,
  canSpeedDown,
  canSpeedUp,
  toggleAnimationPlayback,
  toggleAnimationLoop,
  speedDown,
  speedUp,
} = useCpmAnimations(cpmData)

const hasModel = computed((): boolean => cpmData.value !== null)

const animationTabs = computed((): CpmTabbedPanelData => {
  const data: CpmTabbedPanelData = { tabs: [] }
  for (const group of animationGroups.value) {
    const tab = group.group ?? 'Без группы'
    data.tabs.push(tab)
    data[tab] = group.animations.map((animation) => ({
      id: animation.id,
      label: animation.name,
    }))
  }
  return data
})

const setPlaying = (playing: boolean): void => {
  isAnimationPlaying.value = playing
}

const handleSelect = (): void => {
  selectCpmFile()
}

const handleReset = async (): Promise<void> => {
  await resetCpm()
}

const handleServerAction = (): Promise<void> => handleUploadModel()

const handleOfflineAction = (): Promise<void> => handleSaveModelOffline()
</script>

<template>
  <UserContentViewer
    :is-drag-over="isDragOver"
    :is-offline="isOffline"
    offline-notice="Локальный профиль: модель сохраняется в игру без отправки на сервер"
    :error-message="errorMessage"
    :has-content="hasModel"
    :select-label="hasModel ? 'Заменить модель' : 'Загрузить модель'"
    server-action-label="Отправить"
    offline-action-label="Сохранить в игру"
    :is-server-action-busy="isUploading"
    :is-offline-action-busy="isSaving"
    reset-label="Сбросить модель"
    format-hint="Формат: .cpmproject, не более 2 МБ"
    list-title="Загруженные модели"
    :items="uploadedModels"
    :is-list-loading="isListLoading"
    :list-error="listError"
    @select="handleSelect"
    @server-action="handleServerAction"
    @offline-action="handleOfflineAction"
    @reset="handleReset"
    @copy="handleCopyUrl"
    @delete="handleDeleteModel"
    @retry="loadList"
  >
    <Viewer3D :min-zoom="8">
      <CpmViewer
        :cpm-data="cpmData"
        :active-layers="activeLayerIds"
        :active-animations="activeAnimations"
        :is-animation-playing="isAnimationPlaying"
        :animation-speed="animationSpeed"
        :is-animation-looped="isAnimationLooped"
        @playing-changed="setPlaying"
        @animation-finished="setPlaying(false)"
        @load-error="setTextureError"
      />
      <template #bottom>
        <div class="cpm-settings__playback">
          <CpmAnimationPanel
            v-if="hasModel"
            v-model="selectedAnimationIds"
            :data="animationTabs"
            :has-animation="activeAnimations.length > 0"
            :is-playing="isAnimationPlaying"
            :is-looped="isAnimationLooped"
            :speed="animationSpeed"
            :can-speed-down="canSpeedDown"
            :can-speed-up="canSpeedUp"
            @toggle-play="toggleAnimationPlayback"
            @toggle-loop="toggleAnimationLoop"
            @speed-down="speedDown"
            @speed-up="speedUp"
          />
        </div>
      </template>
    </Viewer3D>

    <template #below-error>
      <CpmTabbedPanel
        v-if="hasModel"
        class="cpm-settings__layer-panel"
        :data="layerPanelData"
        :model-value="visibleLayerKeys"
        title="Слои"
        count-prefix="Показано"
        :show-selection="false"
        empty-data-label="В модели нет слоёв"
        @update:model-value="setVisibleLayerKeys"
      >
        <template #actions>
          <Checkbox
            v-model="showEmptyLayers"
            label="Показать пустые слои"
          />
        </template>
      </CpmTabbedPanel>
    </template>
  </UserContentViewer>
</template>

<style lang="scss">
.cpm-settings {
  &__playback {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__layer-panel {
    width: 100%;
  }
}
</style>
