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
      <Button class="btn-secondary skin-settings__btn" @click="selectSkin">
        {{ hasSkin ? 'Заменить скин' : 'Загрузить скин' }}
      </Button>
      <Button
        v-if="hasSkin"
        class="btn-primary skin-settings__btn skin-settings__btn--upload"
        :is-loading="isUploading"
        :is-disabled="isUploading"
        @click="handleUpload"
      >
        Сохранить
      </Button>
      <Button
        v-if="hasSkin"
        class="btn-danger skin-settings__btn skin-settings__btn--reset"
        @click="resetSkin"
      >
        Удалить
      </Button>
    </div>

    <p class="skin-settings__hint">
      Формат: .png, не более 256 КБ
    </p>

    <div v-if="uploadedSkins.length > 0" class="skin-settings__content-list">
      <div class="skin-settings__content-title section-label">Загруженные скины</div>
      <div class="skin-settings__content-items">
        <div
          v-for="item in uploadedSkins"
          :key="item.id ?? item.url"
          class="skin-settings__content-item"
        >
          <span class="skin-settings__content-url">{{ item.url }}</span>
          <div class="skin-settings__content-actions">
            <Button
              class="btn-quiet skin-settings__copy-btn"
              @click="handleCopyUrl(item.url)"
            >
              Копировать
            </Button>
            <Button
              v-if="item.id != null"
              class="btn-danger skin-settings__delete-btn"
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

  &__actions {
    display: flex;
    gap: var(--space-8);

    .skin-settings__btn {
      flex: 1;
      min-height: var(--control-height);

      &--upload,
      &--reset {
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
