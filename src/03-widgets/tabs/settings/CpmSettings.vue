<script setup lang="ts">
import { computed } from 'vue'
import { Button, Checkbox } from '@/06-shared'
import { useCpmSettings, useCpmAnimations } from '@/04-features'
import CpmAnimationBar from './CpmAnimationBar.vue'
import CpmViewer from './CpmViewer.vue'
import UserContentList from './UserContentList.vue'
import Viewer3D from './Viewer3D.vue'

const {
  cpmData,
  errorMessage,
  showEmptyLayers,
  displayLayers,
  activeLayerIds,
  isUploading,
  isSaving,
  isOffline,
  uploadedModels,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleSaveModelOffline,
  handleDeleteModel,
  handleCopyUrl,
} = useCpmSettings()

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
  <div class="cpm-settings">
    <div v-if="isOffline" class="cpm-settings__notice">
      Локальный профиль: модель сохраняется в игру без отправки на сервер
    </div>

    <Viewer3D v-if="hasModel" :min-zoom="8">
      <CpmViewer
        :cpm-data="cpmData"
        :active-layers="activeLayerIds"
        :active-animations="activeAnimations"
        :is-animation-playing="isAnimationPlaying"
        :animation-speed="animationSpeed"
        :is-animation-looped="isAnimationLooped"
        @animations-changed="setPlaying"
        @animation-finished="setPlaying(false)"
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

    <div v-if="errorMessage" class="cpm-settings__error">
      {{ errorMessage }}
    </div>

    <div v-if="hasModel" class="cpm-settings__layers">
      <Checkbox
        v-model="showEmptyLayers"
        label="Показать пустые слои"
      />

      <div class="cpm-settings__layer-list">
        <Checkbox
          v-for="layer in displayLayers"
          :key="layer.storeId ?? layer.name"
          v-model="layer.visible"
          :label="layer.name"
        />
      </div>
    </div>

    <div class="cpm-settings__actions">
      <Button class="btn-primary cpm-settings__btn" @click="selectCpmFile">
        {{ hasModel ? 'Заменить модель' : 'Загрузить модель' }}
      </Button>
      <Button
        v-if="hasModel && !isOffline"
        class="btn-secondary cpm-settings__btn cpm-settings__btn--upload"
        :is-loading="isUploading"
        :is-disabled="isUploading"
        @click="handleUploadModel"
      >
        Отправить
      </Button>
      <Button
        v-if="hasModel && isOffline"
        class="btn-secondary cpm-settings__btn cpm-settings__btn--upload"
        :is-loading="isSaving"
        :is-disabled="isSaving"
        @click="handleSaveModelOffline"
      >
        Сохранить в игру
      </Button>
      <Button
        v-if="hasModel"
        class="btn-danger cpm-settings__btn cpm-settings__btn--reset"
        @click="resetCpm"
      >
        Сбросить модель
      </Button>
    </div>

    <p class="cpm-settings__hint">
      Формат: .cpmproject, не более 2 МБ
    </p>

    <UserContentList
      v-if="!isOffline && uploadedModels.length > 0"
      title="Загруженные модели"
      :items="uploadedModels"
      @copy="handleCopyUrl"
      @delete="handleDeleteModel"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-settings {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__error {
    @include mixins.error-box;
  }

  &__notice {
    padding: var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--accent-subtle);
    color: var(--accent-text);
    font-size: var(--text-body-sm);
    text-align: left;
  }

  &__layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    align-items: flex-start;
  }

  &__layer-list {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-8);
    max-height: 200px;
    overflow-y: auto;
    width: 100%;
    padding: var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
  }

  &__actions {
    display: flex;
    gap: var(--space-8);

    .cpm-settings__btn {
      flex: 1;
      min-height: var(--control-height);

      &--reset,
      &--upload {
        flex: 0 0 auto;
      }
    }
  }

  &__hint {
    @include mixins.caption-hint;
  }
}
</style>
