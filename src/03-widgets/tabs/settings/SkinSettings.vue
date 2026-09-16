<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'
import { useSkinSettings } from '@/04-features'
import SkinViewer from './SkinViewer.vue'
import UserContentList from './UserContentList.vue'
import Viewer3D from './Viewer3D.vue'

const {
  skinUrl,
  errorMessage,
  isUploading,
  isSkinLoading,
  isOffline,
  uploadedSkins,
  isListLoading,
  isDragOver,
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
    <div v-if="isDragOver" class="skin-settings__drop-overlay">Отпустите файл</div>

    <p v-if="isOffline" class="skin-settings__hint">
      Локальный профиль: скин сохраняется на этом компьютере и применяется при запуске игры
    </p>

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
      <Button class="btn-primary skin-settings__btn" @click="selectSkin">
        {{ hasSkin ? 'Заменить скин' : 'Загрузить скин' }}
      </Button>
      <Button
        v-if="hasSkin && !isOffline"
        class="btn-secondary skin-settings__btn skin-settings__btn--upload"
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
        Сбросить скин
      </Button>
    </div>

    <p class="skin-settings__hint">
      Формат: .png, не более 256 КБ
    </p>

    <UserContentList
      v-if="!isOffline && (isListLoading || uploadedSkins.length > 0)"
      title="Загруженные скины"
      :items="uploadedSkins"
      :is-loading="isListLoading"
      @copy="handleCopyUrl"
      @delete="handleDelete"
    >
      <template #item-actions="{ item }">
        <Button
          v-if="item.id != null && item.active !== true"
          class="btn-primary"
          @click="handleActivate(item.id!)"
        >
          Активировать
        </Button>
        <span v-else-if="item.active === true" class="skin-settings__active-badge">Активен</span>
      </template>
    </UserContentList>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.skin-settings {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__drop-overlay {
    @include mixins.drop-overlay;
  }

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
    animation: skin-settings-spin var(--duration-spin) linear infinite;
  }

  &__loading-text {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
  }

  &__error {
    @include mixins.error-box;
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
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

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
    @include mixins.caption-hint;
  }

  &__active-badge {
    border-radius: var(--radius-badge);
    background: var(--accent-active-bg);
    color: var(--accent-text);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
}

@keyframes skin-settings-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
