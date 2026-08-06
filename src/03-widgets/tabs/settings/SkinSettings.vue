<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'
import { useSkinSettings } from '@/04-features'
import SkinViewer from './SkinViewer.vue'

const {
  skinUrl,
  errorMessage,
  isUploading,
  uploadedSkins,
  selectSkin,
  handleUpload,
  handleDelete,
  handleCopyUrl,
  resetSkin,
} = useSkinSettings()

const hasSkin = computed((): boolean => skinUrl.value !== '')
</script>

<template>
  <div class="skin-settings">
    <div v-if="hasSkin" class="skin-settings__preview">
      <SkinViewer :skin-url="skinUrl" />
    </div>

    <div v-if="errorMessage" class="skin-settings__error">
      {{ errorMessage }}
    </div>

    <div class="skin-settings__actions">
      <Button class="btn-yellow skin-settings__btn" @click="selectSkin">
        {{ hasSkin ? 'Заменить скин' : 'Загрузить скин' }}
      </Button>
      <Button
        v-if="hasSkin"
        class="btn-yellow skin-settings__btn skin-settings__btn--upload"
        :is-loading="isUploading"
        :is-disabled="isUploading"
        @click="handleUpload"
      >
        Сохранить
      </Button>
      <Button
        v-if="hasSkin"
        class="btn-yellow skin-settings__btn skin-settings__btn--reset"
        @click="resetSkin"
      >
        Удалить
      </Button>
    </div>

    <p class="skin-settings__hint">
      Формат: .png, не более 256 КБ
    </p>

    <div v-if="uploadedSkins.length > 0" class="skin-settings__content-list">
      <h3 class="skin-settings__content-title">Загруженные скины</h3>
      <div class="skin-settings__content-items">
        <div
          v-for="item in uploadedSkins"
          :key="item.id ?? item.url"
          class="skin-settings__content-item"
        >
          <span class="skin-settings__content-url">{{ item.url }}</span>
          <div class="skin-settings__content-actions">
            <Button
              class="btn-yellow skin-settings__copy-btn"
              @click="handleCopyUrl(item.url)"
            >
              Копировать
            </Button>
            <Button
              v-if="item.id != null"
              class="btn-yellow skin-settings__delete-btn"
              @click="handleDelete(item.id!)"
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
.skin-settings {
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

  &__actions {
    display: flex;
    gap: 10px;

    .skin-settings__btn {
      flex: 1;
      height: 44px;
      font-size: 14px;
      font-weight: 500;

      &--upload {
        flex: 0 0 auto;
        padding: 0 24px;
      }

      &--reset {
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
