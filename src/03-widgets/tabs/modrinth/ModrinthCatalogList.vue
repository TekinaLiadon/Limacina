<script setup lang="ts">
import { computed } from 'vue'
import { Skeleton, formatCount, formatNumber } from '@/06-shared'
import { MODRINTH_DOWNLOAD_FORMS } from '@/04-features'
import type { ModrinthSearchHit } from '@/05-entities'
import ModrinthRow from './ModrinthRow.vue'

const props = defineProps<{
  hits: ModrinthSearchHit[]
  total: number
  versionNumbers: Record<string, string>
  searchVersionsFailed: boolean
  isSearching: boolean
  searchError: string
  actionError: string
  installedError: string
  installedIds: Set<string>
  updates: Record<string, string>
  installingId: string | null
}>()

const emit = defineEmits<{
  install: [hit: ModrinthSearchHit]
  update: [projectId: string]
  details: [hit: ModrinthSearchHit]
}>()

function versionText(hit: ModrinthSearchHit): string {
  return props.versionNumbers[hit.project_id] ?? ''
}

function isInstalled(hit: ModrinthSearchHit): boolean {
  return props.installedIds.has(hit.project_id)
}

function availableUpdate(projectId: string): string {
  return props.updates[projectId] ?? ''
}

function isBusy(projectId: string): boolean {
  return props.installingId === projectId
}

const errorTexts = computed((): string[] => {
  const texts = [props.searchError, props.actionError, props.installedError]
  return Array.from(new Set(texts.filter((text: string): boolean => text !== '')))
})
</script>

<template>
  <div class="modrinth-catalog">
    <div v-for="text in errorTexts" :key="text" class="modrinth-catalog__error">{{ text }}</div>
    <p v-if="props.searchVersionsFailed && !props.searchError" class="modrinth-catalog__versions-hint">
      Версии модов не загрузились, значки версий могут отсутствовать
    </p>

    <div v-if="props.isSearching && props.hits.length === 0" class="modrinth-catalog__summary" aria-hidden="true">
      <Skeleton
        class="modrinth-catalog__summary-skeleton"
        width="var(--modrinth-summary-skeleton-width)"
        height="calc(var(--text-caption) * var(--leading-caption))"
      />
    </div>
    <div v-else-if="props.hits.length > 0" class="modrinth-catalog__summary">
      <span class="modrinth-catalog__summary-text">Найдено: {{ formatNumber(props.total) }}</span>
    </div>

    <p v-if="!props.isSearching && props.hits.length === 0 && !props.searchError" class="modrinth-catalog__empty">Ничего не найдено</p>
    <div v-else-if="props.isSearching && props.hits.length === 0" class="modrinth-catalog__list" aria-hidden="true">
      <div v-for="index in 6" :key="index" class="modrinth-row">
        <Skeleton variant="list-item" icon-shape="square" :lines="4" flat size="lg" />
      </div>
    </div>
    <TransitionGroup v-else name="modrinth-rows" tag="div" class="modrinth-catalog__list">
      <ModrinthRow
        v-for="(hit, index) in props.hits"
        :key="hit.project_id"
        variant="catalog"
        :style="{ '--modrinth-row-index': String(Math.min(index, 11)) }"
        :icon-url="hit.icon_url"
        :title="hit.title"
        :version-text="versionText(hit)"
        :update-version="availableUpdate(hit.project_id)"
        :is-installed="isInstalled(hit)"
        :is-busy="isBusy(hit.project_id)"
        :is-busy-any="props.installingId !== null"
        :meta-text="`${formatCount(hit.downloads, MODRINTH_DOWNLOAD_FORMS)} · ${hit.author}`"
        :description="hit.description"
        @update="emit('update', hit.project_id)"
        @install="emit('install', hit)"
        @details="emit('details', hit)"
      />
    </TransitionGroup>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-catalog {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__summary {
    display: flex;
    justify-content: flex-end;
  }

  &__summary-text {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__empty {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__error {
    @include mixins.error-box;
  }

  &__versions-hint {
    @include mixins.caption-hint;

    margin: 0;
    text-align: left;
  }
}

.modrinth-rows-enter-active {
  transition: opacity var(--duration-base) var(--ease-out), transform var(--duration-base) var(--ease-out);
  transition-delay: calc(var(--modrinth-row-index, 0) * var(--stagger-step));
}

.modrinth-rows-enter-from {
  opacity: 0;
  transform: translateY(var(--space-8));
}
</style>
