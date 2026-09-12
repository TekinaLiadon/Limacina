<script setup lang="ts">
import { computed } from 'vue'
import { Button, Checkbox } from '@/06-shared'
import { useCpmSettings, useCpmAnimations } from '@/04-features'
import CpmAnimationBar from './CpmAnimationBar.vue'
import CpmViewer from './CpmViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  cpmData,
  errorMessage,
  showEmptyLayers,
  displayLayers,
  activeLayerIds,
  isUploading,
  isOffline,
  uploadedModels,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
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
      Локальный профиль: модель доступна только для предпросмотра и не отправляется на сервер
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
      <Button class="btn-secondary cpm-settings__btn" @click="selectCpmFile">
        {{ hasModel ? 'Заменить модель' : 'Загрузить модель' }}
      </Button>
      <Button
        v-if="hasModel && !isOffline"
        class="btn-primary cpm-settings__btn cpm-settings__btn--upload"
        :is-loading="isUploading"
        :is-disabled="isUploading"
        @click="handleUploadModel"
      >
        Отправить
      </Button>
      <Button
        v-if="hasModel"
        class="btn-danger cpm-settings__btn cpm-settings__btn--reset"
        @click="resetCpm"
      >
        Удалить
      </Button>
    </div>

    <p class="cpm-settings__hint">
      Формат: .cpmproject, не более 2 МБ
    </p>

    <div v-if="!isOffline && uploadedModels.length > 0" class="cpm-settings__content-list">
      <div class="cpm-settings__content-title section-label">Загруженные модели</div>
      <div class="cpm-settings__content-items">
        <div
          v-for="item in uploadedModels"
          :key="item.id ?? item.url"
          class="cpm-settings__content-item"
        >
          <span class="cpm-settings__content-url">{{ item.url }}</span>
          <div class="cpm-settings__content-actions">
            <Button
              class="btn-quiet cpm-settings__copy-btn"
              @click="handleCopyUrl(item.url)"
            >
              Копировать
            </Button>
            <Button
              v-if="item.id != null"
              class="btn-danger cpm-settings__delete-btn"
              @click="handleDeleteModel(item.id!)"
            >
              Удалить
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.cpm-settings {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__error {
    padding: var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    color: var(--error);
    font-size: var(--text-body-sm);
    text-align: left;
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
    margin: 0;
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    text-align: center;
  }

  &__content-list {
    margin-top: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__content-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__content-item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-12);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-card);
  }

  &__content-url {
    flex: 1;
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }

  &__content-actions {
    display: flex;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__copy-btn,
  &__delete-btn {
    padding: var(--space-4) var(--control-padding-x);
    font-size: var(--text-caption);
  }
}
</style>
