<script setup lang="ts">
import { Button, Input } from '@/06-shared'

defineProps<{
  label: string
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  browse: []
}>()
</script>

<template>
  <div class="path-picker">
    <span class="path-picker__label eyebrow">{{ label }}</span>
    <div class="path-picker__row">
      <Input
        :model-value="modelValue"
        :options="{ placeholder: placeholder ?? '', disabled: true }"
      />
      <Button class="btn-secondary path-picker__browse-btn" @click="emit('browse')">
        Обзор
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.path-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  &__row {
    display: flex;
    gap: var(--space-8);
    align-items: center;

    .input__core {
      flex: 1;
    }
  }

  &__browse-btn {
    min-height: var(--control-height);
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
