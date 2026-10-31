<script setup lang="ts">
import { Button, Preloader } from '@/06-shared'
import { useOfflineSkinSettings } from '@/04-features'
import SkinViewer from './SkinViewer.vue'
import UserContentViewer from './UserContentViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  skinUrl,
  errorMessage,
  setTextureError,
  isUploading,
  isMutating,
  isSkinLoading,
  isOffline,
  hasSkin,
  uploadedSkins,
  isListLoading,
  listError,
  loadList,
  isDragOver,
  modelMode,
  selectSkin,
  handleUpload,
  handleActivate,
  handleDelete,
  handleCopyUrl,
  resetSkin,
} = useOfflineSkinSettings()

const modelModes: Array<{ value: typeof modelMode.value; label: string }> = [
  { value: 'classic', label: 'Классик' },
  { value: 'slim', label: 'Слим' },
]
</script>

<template>
  <UserContentViewer
    :is-drag-over="isDragOver"
    :is-offline="isOffline"
    offline-notice="Локальный профиль: скин сохраняется на этом компьютере и применяется при запуске игры"
    :error-message="errorMessage"
    :has-content="hasSkin"
    :select-label="hasSkin ? 'Заменить скин' : 'Загрузить скин'"
    server-action-label="Сохранить"
    :offline-action-label="null"
    :is-server-action-busy="isUploading"
    :is-offline-action-busy="false"
    reset-label="Сбросить скин"
    format-hint="Формат: .png, не более 512 КБ"
    list-title="Загруженные скины"
    :items="uploadedSkins"
    :is-list-loading="isListLoading"
    :list-error="listError"
    @select="selectSkin"
    @server-action="handleUpload"
    @reset="resetSkin"
    @copy="handleCopyUrl"
    @delete="handleDelete"
    @retry="loadList"
  >
    <div v-if="isSkinLoading" class="skin-settings__loading">
      <Preloader local text="Загрузка скина..." />
    </div>

    <template v-else>
      <div v-if="hasSkin" class="skin-settings__model-mode" role="group" aria-label="Модель скина">
        <button
          v-for="mode in modelModes"
          :key="mode.value"
          type="button"
          class="skin-settings__mode-btn"
          :class="{ 'skin-settings__mode-btn--active': modelMode === mode.value }"
          :aria-pressed="modelMode === mode.value"
          @click="modelMode = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>
      <Viewer3D>
        <SkinViewer :skin-url="skinUrl" :slim="modelMode === 'slim'" @load-error="setTextureError" />
      </Viewer3D>
    </template>

    <template #item-actions="{ item }">
      <Button
        v-if="item.id != null && item.active !== true"
        class="btn-primary"
        :is-loading="isMutating"
        :is-disabled="isMutating"
        @click="handleActivate(item.id!)"
      >
        Активировать
      </Button>
      <span v-else-if="item.active === true" class="skin-settings__active-badge">Активен</span>
    </template>
  </UserContentViewer>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.skin-settings {
  &__loading {
    position: relative;
    height: var(--viewer-height);
    overflow: hidden;
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
  }

  &__model-mode {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
  }

  &__mode-btn {
    @include mixins.mode-toggle-button;
  }

  &__active-badge {
    @include mixins.badge(var(--accent-text));

    background: var(--accent-active-bg);
    font-weight: var(--weight-medium);
  }
}
</style>
