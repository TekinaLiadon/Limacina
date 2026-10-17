<script setup lang="ts">
import { computed } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { Button, Checkbox } from '@/06-shared'
import {
  useCpmSettings,
  useCpmAnimations,
  useOfflineCpmModel,
  useCpmAnimationEditor,
  createCpmEditorBridge,
  formatProjectWeight,
  type ActiveCpmAnimation,
} from '@/04-features'
import CpmAnimationBar from './CpmAnimationBar.vue'
import CpmAnimationEditor from './CpmAnimationEditor.vue'
import CpmViewer from './CpmViewer.vue'
import UserContentViewer from './UserContentViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  cpmData,
  cpmFileBytes,
  modelName,
  errorMessage,
  showEmptyLayers,
  displayLayers,
  activeLayerIds,
  toggleLayer,
  setTextureError,
  isUploading,
  isOffline,
  uploadedModels,
  isListLoading,
  listError,
  loadList,
  isDragOver,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
} = useCpmSettings()

const { isSaving, handleSaveModelOffline } = useOfflineCpmModel({
  cpmFileBytes,
  cpmData,
  modelName,
  errorMessage,
})

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

const editorBridge = createCpmEditorBridge()
const editor = useCpmAnimationEditor({
  data: cpmData,
  projectBytes: cpmFileBytes,
  bridge: editorBridge,
  isPlaybackLooped: isAnimationLooped,
})

const hasModel = computed((): boolean => cpmData.value !== null)

const viewerAnimations = computed((): ActiveCpmAnimation[] =>
  editor.isEditing.value ? editor.activeAnimations.value : activeAnimations.value,
)

const viewerPlaying = computed((): boolean =>
  editor.isEditing.value ? editor.isPlaying.value : isAnimationPlaying.value,
)

const viewerLooped = computed((): boolean => isAnimationLooped.value)

const editLabel = computed((): string =>
  selectedAnimationIds.value.length > 0 ? 'Редактировать анимацию' : 'Создать анимацию')

const weightLabel = computed((): string =>
  editor.weight.value === null ? '' : formatProjectWeight(editor.weight.value))

const setPlaying = (playing: boolean): void => {
  if (editor.isEditing.value) {
    editor.setPlaying(playing)
    return
  }
  isAnimationPlaying.value = playing
}

const startEditing = (): void => {
  isAnimationPlaying.value = false
  const [selected] = selectedAnimationIds.value
  editor.startEditing(selected ?? null)
}

const handleSelect = async (): Promise<void> => {
  if (!(await editor.confirmLeave())) return
  selectCpmFile()
}

const handleReset = async (): Promise<void> => {
  if (!(await editor.confirmLeave())) return
  await resetCpm()
}

const runSave = async (action: () => Promise<void>): Promise<void> => {
  if (!editor.prepareSave()) return
  const snapshot = editor.animation.value === null ? undefined : JSON.stringify(editor.animation.value)
  await action()
  if (!editor.isEditing.value || errorMessage.value !== '') return
  editor.markSaved(snapshot)
}

const handleServerAction = (): Promise<void> => runSave(handleUploadModel)
const handleOfflineAction = (): Promise<void> => runSave(handleSaveModelOffline)

onBeforeRouteLeave((): Promise<boolean> => editor.confirmLeave())
</script>

<template>
  <UserContentViewer
    :is-drag-over="isDragOver"
    :is-offline="isOffline"
    offline-notice="Локальный профиль: модель сохраняется в игру без отправки на сервер"
    :error-message="errorMessage"
    :has-content="hasModel"
    :select-label="hasModel ? 'Заменить модель' : 'Загрузить модель'"
    server-action-label="Отправить"
    offline-action-label="Сохранить в игру"
    :is-server-action-busy="isUploading"
    :is-offline-action-busy="isSaving"
    reset-label="Сбросить модель"
    format-hint="Формат: .cpmproject, не более 2 МБ"
    list-title="Загруженные модели"
    :items="uploadedModels"
    :is-list-loading="isListLoading"
    :list-error="listError"
    @select="handleSelect"
    @server-action="handleServerAction"
    @offline-action="handleOfflineAction"
    @reset="handleReset"
    @copy="handleCopyUrl"
    @delete="handleDeleteModel"
    @retry="loadList"
  >
    <Viewer3D :min-zoom="8">
      <CpmViewer
        :cpm-data="cpmData"
        :active-layers="activeLayerIds"
        :active-animations="viewerAnimations"
        :is-animation-playing="viewerPlaying"
        :animation-speed="animationSpeed"
        :is-animation-looped="viewerLooped"
        :editor-bridge="editorBridge"
        :is-editing="editor.isEditing.value"
        :selected-bone-id="editor.selectedBoneId.value"
        @playing-changed="setPlaying"
        @animation-finished="setPlaying(false)"
        @load-error="setTextureError"
        @bone-picked="editor.selectBone"
      />
      <template #bottom>
        <CpmAnimationEditor
          v-if="editor.isEditing.value"
          :editor="editor"
          :bridge="editorBridge"
          :speed="animationSpeed"
          :can-speed-down="canSpeedDown"
          :can-speed-up="canSpeedUp"
          :is-looped="isAnimationLooped"
          @speed-down="speedDown"
          @speed-up="speedUp"
          @toggle-loop="toggleAnimationLoop"
        />
        <div v-else class="cpm-settings__playback">
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
          <Button
            v-if="hasModel"
            class="btn-secondary cpm-settings__edit"
            @click="startEditing"
          >
            {{ editLabel }}
          </Button>
        </div>
      </template>
    </Viewer3D>

    <template #actions-meta>
      <span v-if="hasModel && editor.isWeightLoading.value" class="cpm-settings__weight">
        Вес: …
      </span>
      <span
        v-else-if="hasModel && weightLabel !== ''"
        class="cpm-settings__weight"
        :class="{ 'cpm-settings__weight--over': editor.weight.value?.exceedsLimit }"
        :title="editor.weight.value?.warning ?? ''"
      >
        Вес: {{ weightLabel }}
      </span>
      <span
        v-if="hasModel && editor.weight.value?.exceedsLimit && editor.weight.value.warning"
        class="cpm-settings__weight-warning"
        role="alert"
      >
        {{ editor.weight.value.warning }}
      </span>
      <span v-if="editor.weightError.value" class="cpm-settings__weight cpm-settings__weight--over">
        {{ editor.weightError.value }}
      </span>
    </template>

    <template #below-error>
      <div v-if="hasModel" class="cpm-settings__layers">
        <Checkbox
          v-model="showEmptyLayers"
          label="Показать пустые слои"
        />

        <div class="cpm-settings__layer-list">
          <Checkbox
            v-for="layer in displayLayers"
            :key="layer.storeId ?? layer.name"
            :model-value="layer.visible"
            :disabled="layer.storeId === null"
            :label="layer.name"
            @update:model-value="toggleLayer(layer.storeId)"
          />
        </div>
      </div>
    </template>
  </UserContentViewer>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-settings {
  &__playback {
    display: flex;
    align-items: stretch;
    gap: var(--space-4);

    .cpm-anim-bar {
      flex: 1;
      min-width: 0;
    }
  }

  &__edit {
    flex-shrink: 0;
  }

  &__weight {
    font-size: var(--text-caption);
    color: var(--login-text-muted);
    white-space: nowrap;

    &--over {
      color: var(--error);
    }
  }

  &__weight-warning {
    font-size: var(--text-caption);
    color: var(--error);
  }

  &__layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    align-items: flex-start;
  }

  &__layer-list {
    @include mixins.subtle-card;

    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-8);
    max-height: var(--options-max-height);
    overflow-y: auto;
    width: 100%;
  }
}
</style>
