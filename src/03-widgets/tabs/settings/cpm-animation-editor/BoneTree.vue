<script setup lang="ts">
import type { EditorBoneTreeRow } from '@/04-features'

defineProps<{
  rows: EditorBoneTreeRow[]
  selectedId: number | null
}>()

const emit = defineEmits<{
  select: [storeId: number | null]
}>()

const indent = (depth: number): string => `calc(var(--space-8) + ${depth} * var(--space-12))`
</script>

<template>
  <div class="cpm-bone-tree" role="tree" aria-label="Кости модели">
    <button
      v-for="(row, index) in rows"
      :key="`${row.storeId ?? 'node'}-${index}`"
      type="button"
      class="cpm-bone-tree__row"
      :class="{ 'cpm-bone-tree__row--active': row.storeId !== null && row.storeId === selectedId }"
      :style="{ paddingLeft: indent(row.depth) }"
      role="treeitem"
      :aria-level="row.depth + 1"
      :aria-selected="row.storeId !== null && row.storeId === selectedId"
      :disabled="row.storeId === null"
      @click="emit('select', row.storeId)"
    >
      {{ row.name }}
    </button>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.cpm-bone-tree {
  @include mixins.subtle-card(var(--space-8));

  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: var(--options-max-height);
  overflow-y: auto;

  &__row {
    border: none;
    border-radius: var(--radius-button);
    background: transparent;
    color: var(--login-text-secondary);
    font-family: inherit;
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    text-align: left;
    padding: var(--space-4) var(--space-8);
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out);

    &:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--login-text-primary);
    }

    &:focus-visible {
      outline: var(--focus-ring);
      outline-offset: var(--focus-ring-offset);
    }

    &:disabled {
      opacity: 0.4;
      cursor: default;
    }

    &--active {
      background: var(--surface-active);
      color: var(--login-text-primary);
      box-shadow: var(--elevation-inset);
    }
  }
}
</style>
