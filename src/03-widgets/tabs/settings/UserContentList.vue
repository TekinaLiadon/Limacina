<script setup lang="ts">
import { Button, Skeleton } from '@/06-shared'
import type { UserContentItem } from '@/05-entities'

withDefaults(defineProps<{
  title: string
  items: UserContentItem[]
  isLoading?: boolean
  error?: string
}>(), {
  isLoading: false,
  error: '',
})

const emit = defineEmits<{
  copy: [url: string]
  delete: [id: number]
  retry: []
}>()
</script>

<template>
  <div class="user-content-list">
    <div class="user-content-list__title section-label">{{ title }}</div>
    <div v-if="!isLoading && error" class="user-content-list__error">
      <span class="user-content-list__error-text">{{ error }}</span>
      <Button class="btn-quiet" @click="emit('retry')">
        Повторить
      </Button>
    </div>
    <div v-if="isLoading" class="user-content-list__items" aria-hidden="true">
      <div v-for="index in 3" :key="index" class="user-content-list__item">
        <Skeleton variant="line" height="var(--control-height)" />
      </div>
    </div>
    <div v-else class="user-content-list__items">
      <div
        v-for="item in items"
        :key="item.id ?? item.url"
        class="user-content-list__item"
      >
        <span
          class="user-content-list__url"
          :class="{ 'user-content-list__url--active': item.active === true }"
        >
          {{ item.url }}
        </span>
        <div class="user-content-list__actions">
          <slot name="item-actions" :item="item" />
          <Button
            v-if="item.id != null"
            class="btn-quiet"
            @click="emit('copy', item.url)"
          >
            Копировать
          </Button>
          <Button
            v-if="item.id != null"
            class="btn-danger"
            @click="emit('delete', item.id!)"
          >
            Удалить
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.user-content-list {
  margin-top: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  &__error {
    @include mixins.error-box;

    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
  }

  &__error-text {
    min-width: 0;
  }

  &__items {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-12);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-card);
  }

  &__url {
    flex: 1;
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;

    &--active {
      color: var(--accent-text);
    }
  }

  &__actions {
    display: flex;
    gap: var(--space-4);
    flex-shrink: 0;

    > * {
      display: inline-flex;
      align-items: center;
      padding: var(--space-4) var(--control-padding-x);
      font-size: var(--text-caption);
    }
  }
}
</style>
