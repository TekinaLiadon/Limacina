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
      <Button class="btn-yellow cpm-settings__btn" @click="selectCpmFile">
        {{ hasModel ? 'Заменить модель' : 'Загрузить модель' }}
      </Button>
      <Button
        v-if="hasModel"
        class="btn-yellow cpm-settings__btn cpm-settings__btn--reset"
        @click="resetCpm"
      >
        Удалить
      </Button>
    </div>

    <p class="cpm-settings__hint">
      Формат: .cpmproject, не более 2 МБ
    </p>

    <div class="cpm-settings__txt-block">
      <h3 class="cpm-settings__txt-title">Загрузка модели (.txt)</h3>
      <div class="cpm-settings__txt-actions">
        <Button class="btn-yellow cpm-settings__btn" @click="selectTxtFile">
          {{ hasTxtFile ? 'Заменить файл' : 'Выбрать .txt файл' }}
        </Button>
        <Button
          v-if="hasTxtFile"
          class="btn-yellow cpm-settings__btn cpm-settings__btn--upload"
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
      <h3 class="cpm-settings__content-title">Загруженные модели</h3>
      <div class="cpm-settings__content-items">
        <div
          v-for="item in uploadedModels"
          :key="item.id ?? item.url"
          class="cpm-settings__content-item"
        >
          <span class="cpm-settings__content-url">{{ item.url }}</span>
          <div class="cpm-settings__content-actions">
            <Button
              class="btn-yellow cpm-settings__copy-btn"
              @click="handleCopyUrl(item.url)"
            >
              Копировать
            </Button>
            <Button
              v-if="item.id != null"
              class="btn-yellow cpm-settings__delete-btn"
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
  gap: 20px;

  &__preview {
    width: 100%;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--login-border);
  }

  &__error {
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: 13px;
  }

  &__layers {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__layer-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 200px;
    overflow-y: auto;
    padding: 8px;
    border-radius: 8px;
    background: var(--surface-light);
  }

  &__actions {
    display: flex;
    gap: 10px;

    .cpm-settings__btn {
      flex: 1;
      height: 44px;
      font-size: 14px;
      font-weight: 500;

      &--reset {
        flex: 0 0 auto;
        padding: 0 24px;
      }

      &--save {
        flex: 0 0 auto;
        padding: 0 24px;
      }

      &--upload {
        flex: 0 0 auto;
        padding: 0 24px;
      }
    }
  }

  &__hint {
    margin: 0;
    font-size: 12px;
    color: var(--login-text-muted);
    text-align: center;
  }

  &__txt-block {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--login-border);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__txt-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--login-text-primary);
    margin: 0;
  }

  &__txt-actions {
    display: flex;
    gap: 10px;

    .cpm-settings__btn {
      flex: 1;
      height: 44px;
      font-size: 14px;
      font-weight: 500;

      &--upload {
        flex: 0 0 auto;
        padding: 0 24px;
      }
    }
  }

  &__txt-filename {
    margin: 0;
    font-size: 12px;
    color: var(--login-text-secondary);
  }

  &__txt-hint {
    margin: 0;
    font-size: 12px;
    color: var(--login-text-muted);
  }

  &__content-list {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--login-border);
  }

  &__content-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--login-text-primary);
    margin: 0 0 12px 0;
  }

  &__content-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__content-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface-subtle);
    border: 1px solid var(--login-border);
    border-radius: 8px;
  }

  &__content-url {
    flex: 1;
    font-size: 12px;
    color: var(--login-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__content-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  &__copy-btn,
  &__delete-btn {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
  }
}
</style>
