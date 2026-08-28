<script setup lang="ts">
import { computed } from 'vue'
import { Button, Checkbox } from '@/06-shared'
import { useCpmSettings } from '@/04-features'
import CpmViewer from './CpmViewer.vue'

const {
  cpmData,
  errorMessage,
  showEmptyLayers,
  displayLayers,
  activeLayerNames,
  isUploading,
  uploadedModels,
  txtFileData,
  txtFileName,
  selectCpmFile,
  resetCpm,
  selectTxtFile,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
} = useCpmSettings()

const hasModel = computed((): boolean => cpmData.value !== null)
const hasTxtFile = computed((): boolean => txtFileData.value !== '')
</script>

<template>
  <div class="cpm-settings">
    <div v-if="hasModel" class="cpm-settings__preview">
      <CpmViewer :cpm-data="cpmData" :active-layers="activeLayerNames" />
    </div>

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
          :key="layer.name"
          v-model="layer._visible"
          :label="layer.name"
        />
      </div>
    </div>

    <div class="cpm-settings__actions">
      <Button class="btn-secondary cpm-settings__btn" @click="selectCpmFile">
        {{ hasModel ? 'Заменить модель' : 'Загрузить модель' }}
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

    <div class="cpm-settings__txt-block">
      <div class="cpm-settings__txt-title section-label">Загрузка модели (.txt)</div>
      <div class="cpm-settings__txt-actions">
        <Button class="btn-secondary cpm-settings__btn" @click="selectTxtFile">
          {{ hasTxtFile ? 'Заменить файл' : 'Выбрать .txt файл' }}
        </Button>
        <Button
          v-if="hasTxtFile"
          class="btn-primary cpm-settings__btn cpm-settings__btn--upload"
          :is-loading="isUploading"
          :is-disabled="isUploading"
          @click="handleUploadModel"
        >
          Отправить
        </Button>
      </div>
      <p v-if="txtFileName" class="cpm-settings__txt-filename">
        Выбран: {{ txtFileName }}
      </p>
      <p class="cpm-settings__txt-hint">
        Формат: .txt, не более 1 МБ
      </p>
    </div>

    <div v-if="uploadedModels.length > 0" class="cpm-settings__content-list">
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

  &__preview {
    width: 100%;
    border-radius: var(--radius-card);
    overflow: hidden;
    box-shadow: var(--elevation-inset);
  }

  &__error {
    padding: var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    color: var(--error);
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
      min-height: 40px;

      &--reset,
      &--save,
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

  &__txt-block {
    margin-top: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  &__txt-actions {
    display: flex;
    gap: var(--space-8);

    .cpm-settings__btn {
      flex: 1;
      min-height: 40px;

      &--upload {
        flex: 0 0 auto;
      }
    }
  }

  &__txt-filename {
    margin: 0;
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
  }

  &__txt-hint {
    margin: 0;
    font-size: var(--text-caption);
    color: var(--login-text-muted);
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
    padding: 6px 12px;
    font-size: var(--text-caption);
  }
}
</style>
