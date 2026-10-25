<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Checkbox, Dropdown, Preloader, type DropdownOption } from '@/06-shared'
import {
  builtinPresetSource,
  useCpmAnimations,
  useCpmSettings,
  useModelUserContent,
  useOfflineCpmModel,
  usePresetModels,
  usePresetSkinApply,
} from '@/04-features'
import type { CPMData } from '@/05-entities'
import CpmAnimationPanel from './CpmAnimationPanel.vue'
import CpmTabbedPanel from './CpmTabbedPanel.vue'
import type { CpmTabbedPanelData } from './cpmTabbedPanel'
import CpmViewer from './CpmViewer.vue'
import LoadErrorRow from '@/03-widgets/common/LoadErrorRow.vue'
import UserContentViewer from './UserContentViewer.vue'
import Viewer3D from './Viewer3D.vue'

type ModelSource = 'own' | 'preset'

const content = useModelUserContent()

const {
  cpmData,
  cpmFileBytes,
  cpmSkinPng,
  modelName,
  errorMessage,
  showEmptyLayers,
  activeLayerIds: ownLayerIds,
  layerPanelData,
  visibleLayerKeys,
  setVisibleLayerKeys,
  setTextureError,
  isUploading,
  isDragOver: ownIsDragOver,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
} = useCpmSettings(content)

const { isSaving, handleSaveModelOffline } = useOfflineCpmModel({
  cpmFileBytes,
  cpmData,
  cpmSkinPng,
  modelName,
  errorMessage,
})

const models = usePresetModels(builtinPresetSource)

const {
  skinImage,
  skinMode,
  skinWarnings,
  preview,
  activeLayerIds: presetLayerIds,
  isApplying,
  isDragOver: presetIsDragOver,
  selectSkinFile,
  applyPreset,
} = usePresetSkinApply({
  preset: models.preset,
  previewSkinBytes: models.previewSkinBytes,
  content,
})

const activeSource = ref<ModelSource>('own')

const tabModes: Array<{ value: ModelSource; label: string }> = [
  { value: 'own', label: 'Своя модель' },
  { value: 'preset', label: 'Готовая модель' },
]

let autoSelected = false
watch(models.entries, (entries): void => {
  const [first] = entries
  if (autoSelected || first === undefined) return
  autoSelected = true
  void models.selectPreset(first.slug)
}, { immediate: true })

const presetOptions = computed((): DropdownOption[] =>
  models.entries.value.map((entry) => ({ value: entry.slug, title: entry.name })))

const selectedPresetSlug = computed((): string => models.selectedSlug.value ?? '')

const selectPreset = (slug: string): void => {
  void models.selectPreset(slug)
}

const isPresetSource = computed((): boolean => activeSource.value === 'preset')

const previewCpmData = computed((): CPMData | null => preview.value?.cpmData ?? null)
const activeCpmData = computed((): CPMData | null =>
  isPresetSource.value ? previewCpmData.value : cpmData.value)

const {
  animationGroups,
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
} = useCpmAnimations(activeCpmData)

const hasModel = computed((): boolean => cpmData.value !== null)
const hasPreset = computed((): boolean => models.preset.value !== null)
const hasSkin = computed((): boolean => skinImage.value !== null)
const hasAnimations = computed((): boolean => animationGroups.value.length > 0)

const isDragOver = computed((): boolean => ownIsDragOver.value || presetIsDragOver.value)
const hasContent = computed((): boolean => (isPresetSource.value ? hasPreset.value : hasModel.value))
const isApplyDisabled = computed((): boolean => isPresetSource.value && !hasSkin.value)

const selectLabel = computed((): string => {
  if (isPresetSource.value) return hasSkin.value ? 'Заменить скин' : 'Загрузить скин'
  return hasModel.value ? 'Заменить модель' : 'Загрузить модель'
})

const resetLabel = computed((): string =>
  isPresetSource.value ? 'Сбросить выбор' : 'Сбросить модель')

const formatHint = computed((): string =>
  isPresetSource.value
    ? 'Формат скина: .png, не более 2 МБ (кнопкой или перетаскиванием)'
    : 'Формат: .cpmproject или .bbmodel, не более 4 МБ')

const isApplyBusy = computed((): boolean => {
  if (isPresetSource.value) return isApplying.value
  return content.isOffline.value ? isSaving.value : isUploading.value
})

const viewerEmptyLabel = computed((): string => {
  if (!isPresetSource.value) return 'Загрузите модель, чтобы увидеть её здесь'
  if (!hasPreset.value) return 'Выберите готовую модель из списка'
  return 'Загрузите свой скин, чтобы примерить модель'
})

const activeLayerIds = computed((): number[] =>
  isPresetSource.value ? presetLayerIds.value : ownLayerIds.value)

const animationTabs = computed((): CpmTabbedPanelData => {
  const data: CpmTabbedPanelData = { tabs: [] }
  for (const group of animationGroups.value) {
    const tab = group.group ?? 'Без группы'
    data.tabs.push(tab)
    data[tab] = group.animations.map((animation) => ({
      id: animation.id,
      label: animation.name,
    }))
  }
  return data
})

const modelModes: Array<{ value: typeof skinMode.value; label: string }> = [
  { value: 'classic', label: 'Классик' },
  { value: 'slim', label: 'Слим' },
]

const setPlaying = (playing: boolean): void => {
  isAnimationPlaying.value = playing
}

const handleSelect = (): void => {
  if (isPresetSource.value) {
    selectSkinFile()
    return
  }
  selectCpmFile()
}

const handleApply = (): Promise<void> => {
  if (isPresetSource.value) return applyPreset()
  return content.isOffline.value ? handleSaveModelOffline() : handleUploadModel()
}

const handleReset = (): Promise<void> => {
  if (isPresetSource.value) {
    models.clearSelection()
    return Promise.resolve()
  }
  return resetCpm()
}
</script>

<template>
  <UserContentViewer
    :is-drag-over="isDragOver"
    :is-offline="content.isOffline.value"
    offline-notice="Локальный профиль: модель сохраняется в игру без отправки на сервер"
    :error-message="errorMessage"
    :has-content="hasContent"
    :select-label="selectLabel"
    server-action-label="Отправить"
    offline-action-label="Сохранить в игру"
    :is-server-action-busy="isApplyBusy"
    :is-offline-action-busy="isApplyBusy"
    :is-server-action-disabled="isApplyDisabled"
    :is-offline-action-disabled="isApplyDisabled"
    :reset-label="resetLabel"
    :format-hint="formatHint"
    list-title="Загруженные модели"
    :items="content.items.value"
    :is-list-loading="content.isListLoading.value"
    :list-error="content.listError.value"
    @select="handleSelect"
    @server-action="handleApply"
    @offline-action="handleApply"
    @reset="handleReset"
    @copy="handleCopyUrl"
    @delete="handleDeleteModel"
    @retry="content.loadItems"
  >
    <div class="model-tab__modes" role="group" aria-label="Источник модели">
      <button
        v-for="mode in tabModes"
        :key="mode.value"
        type="button"
        class="model-tab__mode-btn"
        :class="{ 'model-tab__mode-btn--active': activeSource === mode.value }"
        :aria-pressed="activeSource === mode.value"
        @click="activeSource = mode.value"
      >
        {{ mode.label }}
      </button>
    </div>

    <Viewer3D :min-zoom="8" :default-yaw="180">
      <CpmViewer
        v-if="activeCpmData !== null"
        :cpm-data="activeCpmData"
        :active-layers="activeLayerIds"
        :active-animations="activeAnimations"
        :is-animation-playing="isAnimationPlaying"
        :animation-speed="animationSpeed"
        :is-animation-looped="isAnimationLooped"
        @playing-changed="setPlaying"
        @animation-finished="setPlaying(false)"
        @load-error="setTextureError"
      />
      <p v-else class="model-tab__viewer-empty">{{ viewerEmptyLabel }}</p>
      <template #bottom>
        <div class="model-tab__playback">
          <CpmAnimationPanel
            v-if="hasAnimations"
            v-model="selectedAnimationIds"
            :data="animationTabs"
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
        </div>
      </template>
    </Viewer3D>

    <template #below-error>
      <CpmTabbedPanel
        v-if="!isPresetSource && hasModel"
        class="model-tab__layer-panel"
        :data="layerPanelData"
        :model-value="visibleLayerKeys"
        title="Слои"
        count-prefix="Показано"
        :show-selection="false"
        empty-data-label="В модели нет слоёв"
        @update:model-value="setVisibleLayerKeys"
      >
        <template #actions>
          <Checkbox
            v-model="showEmptyLayers"
            label="Показать пустые слои"
          />
        </template>
      </CpmTabbedPanel>

      <div v-else-if="isPresetSource" class="model-tab__preset">
        <div v-if="models.isListLoading.value" aria-hidden="true">
          <Preloader local text="Загрузка каталога..." />
        </div>
        <LoadErrorRow
          v-else-if="models.listError.value !== ''"
          :message="models.listError.value"
          @retry="models.loadCatalog"
        />
        <p v-else-if="presetOptions.length === 0" class="model-tab__preset-empty">
          Готовых моделей пока нет
        </p>
        <template v-else>
          <Dropdown
            class="model-tab__preset-select"
            :options="presetOptions"
            :model-value="selectedPresetSlug"
            width="100%"
            @update:model-value="selectPreset"
          />
          <div v-if="models.isPresetLoading.value">
            <Preloader local text="Загрузка модели..." />
          </div>
          <LoadErrorRow
            v-else-if="models.presetError.value !== ''"
            :message="models.presetError.value"
            @retry="models.retryPreset"
          />
          <template v-else-if="hasPreset">
            <div class="model-tab__skin-mode" role="group" aria-label="Модель скина">
              <button
                v-for="mode in modelModes"
                :key="mode.value"
                type="button"
                class="model-tab__mode-btn"
                :class="{ 'model-tab__mode-btn--active': skinMode === mode.value }"
                :aria-pressed="skinMode === mode.value"
                @click="skinMode = mode.value"
              >
                {{ mode.label }}
              </button>
            </div>
            <ul v-if="skinWarnings.length > 0" class="model-tab__warnings">
              <li
                v-for="warning in skinWarnings"
                :key="warning"
                class="model-tab__warning"
              >
                {{ warning }}
              </li>
            </ul>
            <p v-if="!hasSkin" class="model-tab__hint">Загрузите свой скин, чтобы примерить модель</p>
          </template>
        </template>
      </div>
    </template>
  </UserContentViewer>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.model-tab {
  &__modes,
  &__skin-mode {
    display: flex;
    justify-content: center;
    gap: var(--space-4);
  }

  &__mode-btn {
    @include mixins.mode-toggle;

    min-width: var(--skin-mode-btn-min-width);
    min-height: var(--control-height-sm);
    padding: 0 var(--control-padding-x);
    border-radius: var(--radius-button);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    color: var(--login-text-secondary);

    &:hover {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &--active {
      background: var(--accent-active-bg);
      color: var(--accent-text);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }
  }

  &__viewer-empty,
  &__preset-empty,
  &__hint {
    @include mixins.caption-hint;
  }

  &__playback {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__layer-panel {
    width: 100%;
  }

  &__preset {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__preset-select {
    width: 100%;
  }

  &__warnings {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__warning {
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--accent-subtle);
    color: var(--accent-text);
    font-size: var(--text-caption);
    text-align: left;
  }
}
</style>
