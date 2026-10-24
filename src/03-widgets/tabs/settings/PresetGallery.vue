<script setup lang="ts">
import { computed } from 'vue'
import { Button, Preloader, Skeleton } from '@/06-shared'
import {
  builtinPresetSource,
  useCpmAnimations,
  usePresetModels,
  usePresetSkinApply,
  type PresetSkinType,
} from '@/04-features'
import CpmAnimationPanel from './CpmAnimationPanel.vue'
import type { CpmTabbedPanelData } from './cpmTabbedPanel'
import CpmViewer from './CpmViewer.vue'
import LoadErrorRow from '@/03-widgets/common/LoadErrorRow.vue'
import Viewer3D from './Viewer3D.vue'

const models = usePresetModels(builtinPresetSource)
const applyFlow = usePresetSkinApply({
  preset: models.preset,
  previewSkinBytes: models.previewSkinBytes,
})

const previewCpmData = computed(() => applyFlow.preview.value?.cpmData ?? null)
const hasSkin = computed((): boolean => applyFlow.skinImage.value !== null)

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
} = useCpmAnimations(previewCpmData)

const hasPreset = computed((): boolean => models.preset.value !== null)
const hasAnimations = computed((): boolean => animationGroups.value.length > 0)

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

const skinTypeLabels: Record<PresetSkinType, string> = {
  slim: 'Слим',
  classic: 'Классик',
  both: 'Любой скин',
}

const modelModes: Array<{ value: typeof applyFlow.skinMode.value; label: string }> = [
  { value: 'classic', label: 'Классик' },
  { value: 'slim', label: 'Слим' },
]

const setPlaying = (playing: boolean): void => {
  isAnimationPlaying.value = playing
}
</script>

<template>
  <section class="preset-gallery">
    <div class="preset-gallery__title section-label">Готовые модели</div>

    <div v-if="applyFlow.isDragOver.value" class="preset-gallery__drop-overlay">Отпустите скин</div>

    <div v-if="models.isListLoading.value" class="preset-gallery__grid" aria-hidden="true">
      <div v-for="index in 4" :key="index" class="preset-gallery__card preset-gallery__card--skeleton">
        <Skeleton variant="card" />
      </div>
    </div>
    <LoadErrorRow
      v-else-if="models.listError.value !== ''"
      :message="models.listError.value"
      @retry="models.loadCatalog"
    />
    <p v-else-if="models.entries.value.length === 0" class="preset-gallery__empty">
      Готовых моделей пока нет
    </p>
    <div v-else class="preset-gallery__grid">
      <button
        v-for="entry in models.entries.value"
        :key="entry.slug"
        type="button"
        class="preset-gallery__card"
        :class="{ 'preset-gallery__card--selected': models.selectedSlug.value === entry.slug }"
        :aria-pressed="models.selectedSlug.value === entry.slug"
        @click="models.selectPreset(entry.slug)"
      >
        <span class="preset-gallery__card-preview">
          <img
            v-if="entry.previewUrl !== null"
            class="preset-gallery__card-image"
            :src="entry.previewUrl"
            :alt="entry.name"
          >
          <span v-else class="preset-gallery__card-fallback" aria-hidden="true">
            {{ entry.name.slice(0, 1) }}
          </span>
        </span>
        <span class="preset-gallery__card-name">{{ entry.name }}</span>
        <span class="preset-gallery__card-badge">{{ skinTypeLabels[entry.skinType] }}</span>
      </button>
    </div>

    <div v-if="models.isPresetLoading.value" class="preset-gallery__loading">
      <Preloader local text="Загрузка модели..." />
    </div>
    <LoadErrorRow
      v-else-if="models.presetError.value !== ''"
      :message="models.presetError.value"
      @retry="models.retryPreset"
    />

    <template v-else-if="hasPreset">
      <div v-if="applyFlow.isOffline.value" class="preset-gallery__notice">
        Локальный профиль: модель сохраняется в игру без отправки на сервер
      </div>

      <div v-if="applyFlow.errorMessage.value !== ''" class="preset-gallery__error">
        {{ applyFlow.errorMessage.value }}
      </div>

      <div class="preset-gallery__mode" role="group" aria-label="Модель скина">
        <button
          v-for="mode in modelModes"
          :key="mode.value"
          type="button"
          class="preset-gallery__mode-btn"
          :class="{ 'preset-gallery__mode-btn--active': applyFlow.skinMode.value === mode.value }"
          @click="applyFlow.skinMode.value = mode.value"
        >
          {{ mode.label }}
        </button>
      </div>

      <Viewer3D :min-zoom="8">
        <CpmViewer
          v-if="previewCpmData !== null"
          :cpm-data="previewCpmData"
          :active-layers="applyFlow.activeLayerIds.value"
          :active-animations="activeAnimations"
          :is-animation-playing="isAnimationPlaying"
          :animation-speed="animationSpeed"
          :is-animation-looped="isAnimationLooped"
          @playing-changed="setPlaying"
          @animation-finished="setPlaying(false)"
        />
        <p v-else class="preset-gallery__preview-empty">
          Превью недоступно: загрузите свой скин, чтобы примерить модель
        </p>
        <template #bottom>
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
        </template>
      </Viewer3D>

      <p v-if="!hasSkin" class="preset-gallery__hint">Загрузите свой скин, чтобы примерить модель</p>
      <ul v-if="applyFlow.skinWarnings.value.length > 0" class="preset-gallery__warnings">
        <li
          v-for="warning in applyFlow.skinWarnings.value"
          :key="warning"
          class="preset-gallery__warning"
        >
          {{ warning }}
        </li>
      </ul>

      <div class="preset-gallery__actions">
        <Button class="btn-primary preset-gallery__btn" @click="applyFlow.selectSkinFile">
          {{ hasSkin ? 'Заменить скин' : 'Загрузить скин' }}
        </Button>
        <Button
          class="btn-secondary preset-gallery__btn"
          :is-loading="applyFlow.isApplying.value"
          :is-disabled="!hasSkin || applyFlow.isApplying.value"
          @click="applyFlow.applyPreset"
        >
          {{ applyFlow.isOffline.value ? 'Сохранить в игру' : 'Отправить' }}
        </Button>
        <Button class="btn-danger preset-gallery__btn" @click="models.clearSelection">
          Сбросить выбор
        </Button>
      </div>
      <p class="preset-gallery__format">Формат скина: .png, не более 2 МБ (кнопкой или перетаскиванием)</p>
    </template>
  </section>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.preset-gallery {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__title {
    text-align: left;
  }

  &__drop-overlay {
    @include mixins.drop-overlay;
  }

  &__empty {
    @include mixins.caption-hint(left);
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-12);
  }

  &__card {
    @include mixins.subtle-card($padding: var(--space-8));

    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    border: none;
    font-family: inherit;
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out);

    &:hover {
      background: var(--surface-hover);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &--selected {
      background: var(--accent-active-bg);
    }

    &--skeleton {
      cursor: default;
    }
  }

  &__card-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-badge);
    overflow: hidden;
    background: var(--surface-light);
  }

  &__card-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__card-fallback {
    font-size: var(--text-subheading);
    font-weight: var(--weight-semibold);
    color: var(--login-text-muted);
  }

  &__card-name {
    font-size: var(--text-body-sm);
    color: var(--login-text-primary);
    text-align: center;
    overflow-wrap: anywhere;
  }

  &__card-badge {
    @include mixins.badge;
  }

  &__loading {
    position: relative;
    height: var(--viewer-height);
    overflow: hidden;
    border-radius: var(--radius-card);
    background: var(--surface-subtle);
  }

  &__notice {
    padding: var(--space-12);
    border-radius: var(--radius-badge);
    background: var(--accent-subtle);
    color: var(--accent-text);
    font-size: var(--text-body-sm);
    text-align: left;
  }

  &__error {
    @include mixins.error-box;
  }

  &__mode {
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
  }

  &__preview-empty,
  &__hint {
    @include mixins.caption-hint;
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

  &__actions {
    @include mixins.viewer-actions-row('.preset-gallery__btn');

    align-items: center;
    flex-wrap: wrap;
  }

  &__format {
    @include mixins.caption-hint(left);
  }

  @include breakpoints.media-under-lg {
    &__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @include breakpoints.media-under-md {
    &__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @include breakpoints.media-under-sm {
    &__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-8);
    }
  }
}
</style>
