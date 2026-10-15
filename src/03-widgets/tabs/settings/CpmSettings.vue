<script setup lang="ts">
import { computed } from 'vue'
import { Checkbox } from '@/06-shared'
import { useCpmSettings, useCpmAnimations, useOfflineCpmModel } from '@/04-features'
import CpmAnimationBar from './CpmAnimationBar.vue'
import CpmViewer from './CpmViewer.vue'
import UserContentViewer from './UserContentViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  cpmData,
  cpmFileBytes,
  modelName,
  errorMessage,
  showEmptyLayers,
  displayLayers,
  activeLayerIds,
  toggleLayer,
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
  animationOptions,
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

const setPlaying = (playing: boolean): void => {
  isAnimationPlaying.value = playing
}
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
    @select="selectCpmFile"
    @server-action="handleUploadModel"
    @offline-action="handleSaveModelOffline"
    @reset="resetCpm"
    @copy="handleCopyUrl"
    @delete="handleDeleteModel"
    @retry="loadList"
  >
    <Viewer3D v-show="hasModel" :min-zoom="8">
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
        <CpmAnimationBar
          v-if="animationOptions.length > 0"
          v-model="selectedAnimationIds"
          :options="animationOptions"
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
      </template>
    </Viewer3D>

    <template #below-error>
      <div v-if="hasModel" class="cpm-settings__layers">
        <Checkbox
          v-model="showEmptyLayers"
          label="Показать пустые слои"
        />

        <div class="cpm-settings__layer-list">
          <Checkbox
            v-for="layer in displayLayers"
            :key="layer.storeId ?? layer.name"
            :model-value="layer.visible"
            :disabled="layer.storeId === null"
            :label="layer.name"
            @update:model-value="toggleLayer(layer.storeId)"
          />
        </div>
      </div>
    </template>
  </UserContentViewer>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-settings {
  &__layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    align-items: flex-start;
  }

  &__layer-list {
    @include mixins.subtle-card;

    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-8);
    max-height: var(--options-max-height);
    overflow-y: auto;
    width: 100%;
  }
}
</style>
