<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Checkbox } from '@/06-shared'
import { useCpmSettings } from '@/04-features'
import type { DropdownOption } from '@/06-shared/types'
import type { CPMAnimation } from '@/05-entities/core/types'
import CpmAnimationBar from './CpmAnimationBar.vue'
import CpmViewer from './CpmViewer.vue'
import Viewer3D from './Viewer3D.vue'

const {
  cpmData,
  errorMessage,
  showEmptyLayers,
  displayLayers,
  activeLayerIds,
  isUploading,
  uploadedModels,
  selectCpmFile,
  resetCpm,
  handleUploadModel,
  handleDeleteModel,
  handleCopyUrl,
} = useCpmSettings()

const hasModel = computed((): boolean => cpmData.value !== null)

const availableAnimations = computed((): CPMAnimation[] =>
  (cpmData.value?.animations ?? []).filter((animation) => !animation.hidden),
)

const animationOptions = computed((): DropdownOption[] =>
  availableAnimations.value.map((animation) => ({
    title: animation.name,
    value: animation.id,
  })),
)

const selectedAnimationIds = ref<string[]>([])
const isAnimationPlaying = ref<boolean>(false)
const isAnimationLooped = ref<boolean>(false)
const animationSpeed = ref<number>(1)

const activeAnimations = computed((): CPMAnimation[] => {
  return selectedAnimationIds.value
    .map((id) => availableAnimations.value.find((animation) => animation.id === id))
    .filter((animation): animation is CPMAnimation => animation !== undefined)
})

const SPEED_MIN = 0.25
const SPEED_MAX = 3
const SPEED_STEP = 0.25

const canSpeedDown = computed((): boolean => animationSpeed.value > SPEED_MIN)
const canSpeedUp = computed((): boolean => animationSpeed.value < SPEED_MAX)

watch(availableAnimations, () => {
  const existing = new Set(availableAnimations.value.map((animation) => animation.id))
  const filtered = selectedAnimationIds.value.filter((id) => existing.has(id))
  if (filtered.length !== selectedAnimationIds.value.length) {
    selectedAnimationIds.value = filtered
  }
})

const toggleAnimationPlayback = (): void => {
  if (activeAnimations.value.length === 0) return
  isAnimationPlaying.value = !isAnimationPlaying.value
}

const toggleAnimationLoop = (): void => {
  isAnimationLooped.value = !isAnimationLooped.value
}

const speedDown = (): void => {
  animationSpeed.value = Math.max(SPEED_MIN, Math.round((animationSpeed.value - SPEED_STEP) * 100) / 100)
}

const speedUp = (): void => {
  animationSpeed.value = Math.min(SPEED_MAX, Math.round((animationSpeed.value + SPEED_STEP) * 100) / 100)
}

watch(() => cpmData.value, () => {
  selectedAnimationIds.value = []
  isAnimationPlaying.value = false
  isAnimationLooped.value = false
  animationSpeed.value = 1
})
</script>

<template>
  <div class="cpm-settings">
    <Viewer3D v-if="hasModel" :min-zoom="8" :max-zoom="150">
      <CpmViewer
        :cpm-data="cpmData"
        :active-layers="activeLayerIds"
        :active-animations="activeAnimations"
        :is-animation-playing="isAnimationPlaying"
        :animation-speed="animationSpeed"
        :is-animation-looped="isAnimationLooped"
      />
      <template #bottom>
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
      </template>
    </Viewer3D>

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
          :key="layer.storeID ?? layer.name"
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
        class="btn-primary cpm-settings__btn cpm-settings__btn--upload"
        :is-loading="isUploading"
        :is-disabled="isUploading"
        @click="handleUploadModel"
      >
        Отправить
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
      min-height: var(--control-height);

      &--reset,
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
