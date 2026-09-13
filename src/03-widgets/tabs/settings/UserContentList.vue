<script setup lang="ts">
import { Button } from '@/06-shared'
import type { UserContentItem } from '@/05-entities/core/types'

defineProps<{
  title: string
  items: UserContentItem[]
}>()

const emit = defineEmits<{
  copy: [url: string]
  delete: [id: number]
}>()
</script>

<template>
  <div class="user-content-list">
    <div class="user-content-list__title section-label">{{ title }}</div>
    <div class="user-content-list__items">
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
.user-content-list {
  margin-top: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

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
