<script setup lang="ts">
import { computed } from 'vue'
import {
  useCpmSettings,
  useModelUserContent,
  useOfflineCpmModel,
} from '@/04-features'
import UserContentViewer from '../UserContentViewer.vue'
import {
  BLOCKBENCH_CARD_HINT,
  BLOCKBENCH_CARD_TITLE,
  EMPTY_STATES,
  FORMAT_HINTS,
  LIST_TITLES,
} from './copy'

const MODEL_MAX_BYTES = 4 * 1024 * 1024
const BBMODEL_ACCEPT = '.bbmodel'
const BBMODEL_EXTENSIONS = ['bbmodel']

const content = useModelUserContent()

const {
  cpmData,
  cpmFileBytes,
  cpmSkinPng,
  modelName,
  errorMessage,
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
} = useCpmSettings(content, {
  format: 'bbmodel',
  accept: BBMODEL_ACCEPT,
  extensions: BBMODEL_EXTENSIONS,
  maxBytes: MODEL_MAX_BYTES,
})

const { isSaving, handleSaveModelOffline } = useOfflineCpmModel({
  cpmFileBytes,
  cpmData,
  cpmSkinPng,
  modelName,
  errorMessage,
  format: 'bbmodel',
})

const hasModel = computed((): boolean => cpmData.value !== null)
const elementCount = computed((): number => cpmData.value?.config.elements.length ?? 0)
const animationCount = computed((): number => cpmData.value?.animations?.length ?? 0)

const selectLabel = computed((): string => (hasModel.value ? 'Заменить модель' : 'Загрузить модель'))

const isApplyBusy = computed((): boolean =>
  content.isOffline.value ? isSaving.value : isUploading.value)

const handleApply = (): Promise<void> =>
  content.isOffline.value ? handleSaveModelOffline() : handleUploadModel()
</script>

<template>
  <div class="model-tab__panel">
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
      :format-hint="FORMAT_HINTS.blockbench(MODEL_MAX_BYTES)"
      :list-title="LIST_TITLES.blockbench"
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
      <div v-if="hasModel" class="model-tab__bbmodel-card">
        <p class="model-tab__bbmodel-title">{{ BLOCKBENCH_CARD_TITLE }}</p>
        <p class="model-tab__bbmodel-name">{{ modelName }}</p>
        <div class="model-tab__bbmodel-stats">
          <div class="model-tab__bbmodel-stat">
            <span class="model-tab__bbmodel-label">Элементы</span>
            <span class="model-tab__bbmodel-value">{{ elementCount }}</span>
          </div>
          <div class="model-tab__bbmodel-stat">
            <span class="model-tab__bbmodel-label">Анимации</span>
            <span class="model-tab__bbmodel-value">{{ animationCount }}</span>
          </div>
        </div>
        <p class="model-tab__bbmodel-hint">{{ BLOCKBENCH_CARD_HINT }}</p>
      </div>
      <p v-else class="model-tab__viewer-empty">{{ EMPTY_STATES.blockbench }}</p>
    </UserContentViewer>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.model-tab {
  &__bbmodel-card {
    @include mixins.subtle-card;

    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    text-align: left;
  }

  &__bbmodel-title {
    margin: 0;
    font-size: var(--text-subheading);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }

  &__bbmodel-name {
    margin: 0;
    font-size: var(--text-body-sm);
    color: var(--login-text-secondary);
  }

  &__bbmodel-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-24);
  }

  &__bbmodel-stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__bbmodel-label {
    @include mixins.eyebrow;
  }

  &__bbmodel-value {
    font-size: var(--text-heading-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
    font-variant-numeric: tabular-nums;
  }

  &__bbmodel-hint {
    @include mixins.caption-hint(left);
  }
}
</style>
