<script setup lang="ts">
import { Checkbox } from '@/06-shared'

defineProps<{
  label: string
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="game-checkbox-field">
    <span class="game-checkbox-field__text">{{ label }}</span>
    <Checkbox :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-checkbox-field {
  @include mixins.settings-row-body;

  min-width: 0;

  &__text {
    white-space: nowrap;
  }
}
</style>
