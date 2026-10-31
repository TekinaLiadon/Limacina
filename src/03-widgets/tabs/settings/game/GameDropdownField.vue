<script setup lang="ts">
import { useId } from 'vue'
import { Dropdown, type DropdownOption } from '@/06-shared'

defineProps<{
  label: string
  options: DropdownOption[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const labelId = useId()
</script>

<template>
  <div class="game-dropdown-field">
    <span :id="labelId" class="game-dropdown-field__text">{{ label }}</span>
    <Dropdown
      class="game-dropdown-field__control"
      :aria-labelledby="labelId"
      :options="options"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-dropdown-field {
  @include mixins.settings-row-body;

  min-width: 0;

  &__text {
    white-space: nowrap;
  }

  &__control {
    min-width: var(--settings-control-min-width);
  }
}
</style>
