<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'
import { useSkinSettings } from '@/04-features'
import SkinViewer from './SkinViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  skinUrl,
  errorMessage,
  isUploading,
  isSkinLoading,
  uploadedSkins,
  modelMode,
  selectSkin,
  handleUpload,
  handleActivate,
  handleDelete,
  handleCopyUrl,
  resetSkin,
} = useSkinSettings()

const hasSkin = computed((): boolean => skinUrl.value !== '')

const modelModes: Array<{ value: typeof modelMode.value; label: string }> = [
  { value: 'classic', label: 'Классик' },
  { value: 'slim', label: 'Слим' },
]
</script>

<template>
  <div class="skin-settings">
    <div v-if="isSkinLoading" class="skin-settings__loading">
      <span class="skin-settings__loading-spinner" aria-hidden="true" />
      <span class="skin-settings__loading-text">Загрузка скина...</span>
    </div>

    <template v-else-if="hasSkin">
      <div class="skin-settings__model-mode" role="group" aria-label="Модель скина">
        <button
          v-for="mode in modelModes"
          :key="mode.value"
          type="button"
          class="skin-settings__mode-btn"
          :class="{ 'skin-settings__mode-btn--active': modelMode === mode.value }"
          @click="modelMode = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
      <Viewer3D>
        <SkinViewer :skin-url="skinUrl" :slim="modelMode === 'slim'" />
      </Viewer3D>
    </template>

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
          <span class="skin-settings__content-url" :class="{ 'skin-settings__content-url--active': item.active === true }">
            {{ item.url }}
          </span>
          <div class="skin-settings__content-actions">
            <Button
              v-if="item.id != null && item.active !== true"
              class="btn-primary skin-settings__activate-btn"
              @click="handleActivate(item.id!)"
            >
              Активировать
            </Button>
            <span v-else-if="item.active === true" class="skin-settings__active-badge">Активен</span>
            <Button
              v-if="item.id != null"
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

  &__loading {
    height: 360px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-12);
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
  }

  &__loading-spinner {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-circle);
    border: 2px solid var(--surface-active);
    border-top-color: var(--login-accent);
    animation: skin-settings-spin 0.8s linear infinite;
  }

  &__loading-text {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
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

  &__model-mode {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
  }

  &__mode-btn {
    min-width: 96px;
    min-height: var(--control-height-sm);
    padding: 0 var(--control-padding-x);
    border: none;
    border-radius: var(--radius-button);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    color: var(--login-text-secondary);
    font-family: inherit;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &--active {
      background: var(--accent-active-bg);
      color: var(--accent-text);
    }
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

    &--active {
      color: var(--accent-text);
    }
  }

  &__active-badge {
    padding: var(--space-4) var(--control-padding-x);
    border-radius: var(--radius-badge);
    background: var(--accent-active-bg);
    color: var(--accent-text);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }

  &__content-actions {
    display: flex;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  &__copy-btn,
  &__delete-btn,
  &__activate-btn {
    padding: var(--space-4) var(--control-padding-x);
    font-size: var(--text-caption);
  }
}

@keyframes skin-settings-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
