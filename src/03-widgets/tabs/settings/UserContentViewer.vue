<script setup lang="ts">
import { Button } from '@/06-shared'
import type { UserContentItem } from '@/05-entities'
import UserContentList from './UserContentList.vue'

const props = defineProps<{
  isDragOver: boolean
  isOffline: boolean
  offlineNotice: string
  errorMessage: string
  hasContent: boolean
  selectLabel: string
  serverActionLabel: string | null
  offlineActionLabel: string | null
  isServerActionBusy: boolean
  isOfflineActionBusy: boolean
  resetLabel: string
  formatHint: string
  listTitle: string
  items: UserContentItem[]
  isListLoading: boolean
  listError: string
}>()

const emit = defineEmits<{
  select: []
  serverAction: []
  offlineAction: []
  reset: []
  copy: [url: string]
  delete: [id: number]
  retry: []
}>()
</script>

<template>
  <div class="user-content-viewer">
    <div v-if="props.isDragOver" class="user-content-viewer__drop-overlay">Отпустите файл</div>

    <div v-if="props.isOffline" class="user-content-viewer__notice">{{ props.offlineNotice }}</div>

    <slot />

    <div v-if="props.errorMessage" class="user-content-viewer__error">{{ props.errorMessage }}</div>

    <slot name="below-error" />

    <div class="user-content-viewer__actions">
      <div v-if="$slots['actions-meta']" class="user-content-viewer__actions-meta">
        <slot name="actions-meta" />
      </div>
      <Button class="btn-primary user-content-viewer__btn" @click="emit('select')">
        {{ props.selectLabel }}
      </Button>
      <Button
        v-if="props.hasContent && !props.isOffline && props.serverActionLabel !== null"
        class="btn-secondary user-content-viewer__btn user-content-viewer__btn--upload"
        :is-loading="props.isServerActionBusy"
        :is-disabled="props.isServerActionBusy"
        @click="emit('serverAction')"
      >
        {{ props.serverActionLabel }}
      </Button>
      <Button
        v-if="props.hasContent && props.isOffline && props.offlineActionLabel !== null"
        class="btn-secondary user-content-viewer__btn user-content-viewer__btn--upload"
        :is-loading="props.isOfflineActionBusy"
        :is-disabled="props.isOfflineActionBusy"
        @click="emit('offlineAction')"
      >
        {{ props.offlineActionLabel }}
      </Button>
      <Button
        v-if="props.hasContent"
        class="btn-danger user-content-viewer__btn user-content-viewer__btn--reset"
        @click="emit('reset')"
      >
        {{ props.resetLabel }}
      </Button>
    </div>

    <p class="user-content-viewer__hint">{{ props.formatHint }}</p>

    <UserContentList
      v-if="!props.isOffline && (props.isListLoading || props.listError || props.items.length > 0)"
      :title="props.listTitle"
      :items="props.items"
      :is-loading="props.isListLoading"
      :error="props.listError"
      @copy="emit('copy', $event)"
      @delete="emit('delete', $event)"
      @retry="emit('retry')"
    >
      <template v-if="$slots['item-actions']" #item-actions="listSlot">
        <slot name="item-actions" v-bind="listSlot" />
      </template>
    </UserContentList>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.user-content-viewer {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__drop-overlay {
    @include mixins.drop-overlay;
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

  &__actions {
    @include mixins.viewer-actions-row('.user-content-viewer__btn');

    align-items: center;
    flex-wrap: wrap;
  }

  &__actions-meta {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    margin-right: auto;
  }

  &__hint {
    @include mixins.caption-hint;
  }
}
</style>
