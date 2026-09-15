<script setup lang="ts">
defineProps<{
  label: string
  value: string
}>()
</script>

<template>
  <div class="settings-info-row">
    <span class="settings-info-row__label">{{ label }}</span>
    <span class="settings-info-row__value">{{ value }}</span>
  </div>
</template>

<style lang="scss">
.settings-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  width: 100%;
  padding: var(--space-8) 0;
  border-bottom: 1px solid var(--border-subtle);

  &__label {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    color: var(--login-text-muted);
    flex-shrink: 0;
  }

  &__value {
    font-size: var(--text-body-sm);
    line-height: var(--leading-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
