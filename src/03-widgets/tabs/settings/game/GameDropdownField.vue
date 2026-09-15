<script setup lang="ts">
import { Dropdown, type DropdownOption } from '@/06-shared'

defineProps<{
  label: string
  options: DropdownOption[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <div class="game-dropdown-field">
    <span class="game-dropdown-field__text">{{ label }}</span>
    <Dropdown
      class="game-dropdown-field__control"
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

  .dropdown__value {
    min-width: 180px;
  }
}
</style>
