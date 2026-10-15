<script setup lang="ts">
import { Button } from '@/06-shared'
import ModrinthIcon from './ModrinthIcon.vue'
import ModrinthInstallActions from './ModrinthInstallActions.vue'
import ModrinthUpdateBadge from './ModrinthUpdateBadge.vue'

const props = defineProps<{
  variant: 'installed' | 'catalog'
  iconUrl: string | null
  title: string
  versionText: string
  updateVersion: string
  isInstalled: boolean
  isBusy: boolean
  isBusyAny: boolean
  metaText: string
  description?: string
}>()

const emit = defineEmits<{
  update: []
  install: []
  uninstall: []
  details: []
}>()
</script>

<template>
  <article class="modrinth-row">
    <ModrinthIcon :src="props.iconUrl" :title="props.title" />
    <div class="modrinth-row__info">
      <div class="modrinth-row__head">
        <span class="modrinth-row__title">{{ props.title }}</span>
        <span v-if="props.versionText" class="modrinth-row__badge">{{ props.versionText }}</span>
        <ModrinthUpdateBadge v-if="props.updateVersion" :version="props.updateVersion" />
      </div>
      <p v-if="props.description" class="modrinth-row__description">{{ props.description }}</p>
      <span class="modrinth-row__meta">{{ props.metaText }}</span>
    </div>
    <div class="modrinth-row__actions">
      <ModrinthInstallActions
        :is-installed="props.isInstalled"
        :update-version="props.updateVersion"
        :is-busy="props.isBusy"
        :is-busy-any="props.isBusyAny"
        @update="emit('update')"
        @install="emit('install')"
      />
      <Button
        v-if="props.variant === 'installed'"
        class="btn-danger"
        :is-loading="props.isBusy"
        :is-disabled="props.isBusyAny"
        @click="emit('uninstall')"
      >
        Удалить
      </Button>
      <Button v-else class="btn-secondary" @click="emit('details')">Подробнее</Button>
    </div>
  </article>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';
@use '@/01-app/assets/breakpoints';

.modrinth-row {
  @include mixins.subtle-card(var(--space-8) var(--space-12));

  display: flex;
  align-items: center;
  gap: var(--space-12);

  &__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__head {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__title {
    font-weight: var(--weight-medium);
    overflow-wrap: anywhere;
  }

  &__badge {
    @include mixins.badge;
  }

  &__description {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-secondary);
  }

  &__meta {
    @include mixins.caption-hint;
    text-align: left;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
  }

  @include breakpoints.media-under-md {
    flex-direction: column;
    align-items: flex-start;

    &__actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
}
</style>
