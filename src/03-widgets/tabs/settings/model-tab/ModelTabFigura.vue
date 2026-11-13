<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button, Skeleton } from '@/06-shared'
import { useCoreStore } from '@/05-entities'
import { useFiguraAvatars } from '@/04-features'
import { EMPTY_STATES, ERRORS, MODEL_TAB_TITLES } from './copy'
import FiguraViewer from './FiguraViewer.vue'

const coreStore = useCoreStore()

const {
  avatars,
  selectedName,
  selected,
  isListLoading,
  listError,
  modelError,
  textureError,
  viewerSource,
  loadList,
  selectAvatar,
} = useFiguraAvatars()

const isViewerTextureFailed = ref<boolean>(false)

const isCatalogEmpty = computed((): boolean =>
  avatars.value !== null && avatars.value.length === 0,
)

const textureMessage = computed((): string =>
  textureError.value !== '' || isViewerTextureFailed.value ? ERRORS.figuraTextureMissing : '',
)

const viewerHint = computed((): string => {
  if (selected.value !== null) return ''
  if (isCatalogEmpty.value) return EMPTY_STATES.figuraNoAvatars
  if (avatars.value === null) return ''
  return EMPTY_STATES.figuraNoSelection
})

const refresh = async (): Promise<void> => {
  await loadList()
}

const select = async (name: string): Promise<void> => {
  await selectAvatar(name)
}

const handleTextureError = (): void => {
  isViewerTextureFailed.value = true
}

watch(viewerSource, (): void => {
  isViewerTextureFailed.value = false
})

watch((): string => coreStore.currentProject, (): void => {
  void loadList()
})

onMounted((): void => {
  void loadList()
})
</script>

<template>
  <div class="model-tab__figura">
    <div v-if="listError" class="model-tab__figura-error">{{ listError }}</div>
    <div v-if="modelError" class="model-tab__figura-error">{{ modelError }}</div>
    <div v-if="textureMessage" class="model-tab__figura-error">{{ textureMessage }}</div>

    <div class="model-tab__figura-head">
      <span class="model-tab__figura-title section-label">{{ MODEL_TAB_TITLES.figura }}</span>
      <Button
        class="btn-secondary model-tab__figura-refresh"
        :is-loading="isListLoading"
        :is-disabled="isListLoading"
        @click="refresh"
      >
        Обновить
      </Button>
    </div>

    <div v-if="isListLoading" class="model-tab__figura-list" aria-hidden="true">
      <Skeleton
        v-for="index in 3"
        :key="index"
        variant="line"
        height="var(--control-height)"
      />
    </div>
    <div
      v-else-if="avatars !== null && avatars.length > 0"
      class="model-tab__figura-list"
      role="group"
      :aria-label="MODEL_TAB_TITLES.figura"
    >
      <div v-for="avatar in avatars" :key="avatar.name" class="model-tab__figura-item">
        <button
          type="button"
          class="model-tab__figura-avatar"
          :class="{ 'model-tab__figura-avatar--active': selectedName === avatar.name }"
          :aria-pressed="selectedName === avatar.name"
          @click="select(avatar.name)"
        >
          <span class="model-tab__figura-avatar-name">{{ avatar.name }}</span>
          <span class="model-tab__figura-avatar-author">{{ avatar.authors.join(', ') }}</span>
        </button>
      </div>
    </div>
    <div v-if="selected" class="model-tab__figura-card">
      <div class="model-tab__figura-card-name">{{ selected.name }}</div>
      <div class="model-tab__figura-card-author">{{ selected.authors.join(', ') }}</div>
      <p class="model-tab__figura-card-description">{{ selected.description }}</p>
    </div>

    <FiguraViewer :source="viewerSource" @texture-error="handleTextureError">
      <template v-if="viewerHint !== ''" #empty>{{ viewerHint }}</template>
    </FiguraViewer>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.model-tab__figura {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);
}

.model-tab__figura-error {
  @include mixins.error-box;
}

.model-tab__figura-head {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}

.model-tab__figura-title {
  flex: 1;
  min-width: 0;
}

.model-tab__figura-refresh {
  flex-shrink: 0;
}

.model-tab__figura-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.model-tab__figura-item {
  min-width: 0;
}

.model-tab__figura-avatar {
  @include mixins.subtle-card(var(--space-8) var(--space-12));

  display: flex;
  align-items: baseline;
  gap: var(--space-8);
  width: 100%;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

  &:hover {
    background: var(--surface-hover);
  }

  &:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
}

.model-tab__figura-avatar--active {
  background: var(--accent-active-bg);
}

.model-tab__figura-avatar-name {
  font-size: var(--text-body-sm);
  font-weight: var(--weight-medium);
  color: var(--login-text-primary);
}

.model-tab__figura-avatar-author {
  font-size: var(--text-caption);
  color: var(--login-text-muted);
}

.model-tab__figura-avatar--active .model-tab__figura-avatar-name,
.model-tab__figura-avatar--active .model-tab__figura-avatar-author {
  color: var(--accent-text);
}

.model-tab__figura-card {
  @include mixins.subtle-card-column;

  align-items: flex-start;
}

.model-tab__figura-card-name {
  font-size: var(--text-body-sm);
  font-weight: var(--weight-medium);
  color: var(--login-text-primary);
}

.model-tab__figura-card-author {
  font-size: var(--text-caption);
  color: var(--login-text-muted);
}

.model-tab__figura-card-description {
  margin: 0;
  font-size: var(--text-body-sm);
  color: var(--login-text-secondary);
}
</style>
