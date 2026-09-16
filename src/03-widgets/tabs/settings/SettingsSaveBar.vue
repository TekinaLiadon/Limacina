<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  isSaving: boolean
  isDirty: boolean
}>()

defineEmits<{
  save: []
}>()
</script>

<template>
  <div class="settings-save-bar">
    <div class="settings-save-bar__inner">
      <slot name="extra" />
      <Button
        class="btn-lg settings-save-bar__btn"
        :class="{ 'settings-save-bar__btn--dirty': isDirty }"
        :is-loading="isSaving"
        :is-disabled="isSaving"
        @click="$emit('save')"
      >
        Сохранить
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.settings-save-bar {
  position: sticky;
  bottom: 0;
  z-index: var(--z-sticky);
  margin: auto calc(-1 * var(--page-padding-x)) 0;
  padding: var(--space-16) var(--page-padding-x);
  background: var(--login-bg-form);
  border-top: 1px solid var(--border-subtle);

  &__inner {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--element-gap);
    flex-wrap: wrap;
  }

  &__btn {
    min-width: 220px;
    background: var(--surface-light);
    color: var(--login-text-muted);
    box-shadow: var(--elevation-inset);

    &:hover:not(.disabled) {
      color: var(--login-text-primary);
      background: var(--surface-hover);
    }

    &--dirty {
      background: var(--accent-fill);
      color: var(--text-on-accent-fill);
      box-shadow: var(--elevation-inset), var(--elevation-glow);

      &:hover:not(.disabled) {
        color: var(--text-on-accent-fill);
        filter: brightness(1.12);
      }
    }
  }
}
</style>
