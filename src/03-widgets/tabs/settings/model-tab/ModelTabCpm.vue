<script setup lang="ts">
import { computed } from 'vue'
import { Checkbox } from '@/06-shared'
import {
  useCpmAnimations,
  useCpmSettings,
  useModelUserContent,
  useOfflineCpmModel,
} from '@/04-features'
import CpmAnimationPanel from '../CpmAnimationPanel.vue'
import CpmTabbedPanel from '../CpmTabbedPanel.vue'
import type { CpmTabbedPanelData } from '../cpmTabbedPanel'
import CpmViewer from '../CpmViewer.vue'
import UserContentViewer from '../UserContentViewer.vue'
import Viewer3D from '../Viewer3D.vue'
import { EMPTY_STATES, FORMAT_HINTS, LIST_TITLES } from './copy'

const MODEL_MAX_BYTES = 4 * 1024 * 1024
const FORMAT_HINT = FORMAT_HINTS.cpm(MODEL_MAX_BYTES)

const content = useModelUserContent()

const {
  cpmData,
  cpmFileBytes,
  cpmSkinPng,
  modelName,
  errorMessage,
  showEmptyLayers,
  activeLayerIds,
  layerPanelData,
  visibleLayerKeys,
  setVisibleLayerKeys,
  setTextureError,
  isUploading,
  isDragOver,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
  uploadedModels,
  isListLoading,
  listError,
  loadList,
} = useCpmSettings(content, { format: 'cpm' })

const { isSaving, handleSaveModelOffline } = useOfflineCpmModel({
  cpmFileBytes,
  cpmData,
  cpmSkinPng,
  modelName,
  errorMessage,
  format: 'cpm',
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
const hasAnimations = computed((): boolean => animationGroups.value.length > 0)

const selectLabel = computed((): string => (hasModel.value ? 'Заменить модель' : 'Загрузить модель'))

const isApplyBusy = computed((): boolean =>
  content.isOffline.value ? isSaving.value : isUploading.value)

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

const handleApply = (): Promise<void> =>
  content.isOffline.value ? handleSaveModelOffline() : handleUploadModel()
</script>

<template>
  <UserContentViewer
    :is-drag-over="isDragOver"
    :is-offline="content.isOffline.value"
    offline-notice="Локальный профиль: модель сохраняется в игру без отправки на сервер"
    :error-message="errorMessage"
    :has-content="hasModel"
    :select-label="selectLabel"
    server-action-label="Отправить"
    offline-action-label="Сохранить в игру"
    :is-server-action-busy="isApplyBusy"
    :is-offline-action-busy="isApplyBusy"
    reset-label="Сбросить модель"
    :format-hint="FORMAT_HINT"
    :list-title="LIST_TITLES.cpm"
    :items="uploadedModels"
    :is-list-loading="isListLoading"
    :list-error="listError"
    @select="selectCpmFile"
    @server-action="handleApply"
    @offline-action="handleApply"
    @reset="resetCpm"
    @copy="handleCopyUrl"
    @delete="handleDeleteModel"
    @retry="loadList"
  >
    <Viewer3D :min-zoom="8" :default-yaw="180">
      <CpmViewer
        v-if="cpmData !== null"
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
      <p v-else class="model-tab__viewer-empty">{{ EMPTY_STATES.cpm }}</p>
      <template #bottom>
        <div class="model-tab__playback">
          <CpmAnimationPanel
            v-if="hasAnimations"
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
        class="model-tab__layer-panel"
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
