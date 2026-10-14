<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Checkbox, Input, type InputOptions } from '@/06-shared'
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
  modelsLimit,
  isLimitLoading,
  limitLoadError,
  isSavingLimit,
  limitSaveError,
  isDragOver,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
  handleSaveModelsLimit,
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

const limitInput = ref<string>('')
const limitOptions = computed<InputOptions>((): InputOptions => ({
  label: 'Лимит хранимых моделей',
  placeholder: limitLoadError.value
    ? 'Недоступно'
    : isLimitLoading.value || isSavingLimit.value
      ? 'Загрузка...'
      : 'Не ограничен',
  disabled: isLimitLoading.value,
}))

watch(modelsLimit, (): void => {
  limitInput.value = modelsLimit.value === null ? '' : String(modelsLimit.value)
}, { immediate: true })

const applyLimitInput = async (): Promise<void> => {
  const raw = limitInput.value.trim()
  const parsed = raw === '' ? null : Number(raw)
  if (parsed !== modelsLimit.value) {
    await handleSaveModelsLimit(parsed)
  }
  limitInput.value = modelsLimit.value === null ? '' : String(modelsLimit.value)
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

    <template #after-actions>
      <div class="cpm-settings__limit">
        <Input
          v-model="limitInput"
          class="cpm-settings__limit-input"
          :options="limitOptions"
          @keydown.enter="applyLimitInput"
          @blur="applyLimitInput"
        />
        <div v-if="limitSaveError" class="cpm-settings__limit-error" role="alert">
          {{ limitSaveError }}
        </div>
        <div v-if="limitLoadError" class="cpm-settings__limit-error" role="alert">
          Не удалось загрузить лимит моделей: {{ limitLoadError }}
        </div>
        <p class="cpm-settings__hint cpm-settings__limit-hint">
          Сколько моделей игра хранит в папке player_models: самые старые удаляются
        </p>
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

  &__hint {
    @include mixins.caption-hint;
  }

  &__limit {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: var(--settings-row-width);
  }

  &__limit-error {
    @include mixins.error-box;
  }

  &__limit-hint {
    text-align: left;
  }
}
</style>
