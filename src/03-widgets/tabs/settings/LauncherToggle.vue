<script setup lang="ts">
import { Checkbox } from '@/06-shared'

defineProps<{
  modelValue: boolean
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <div class="launcher-toggles__item">
    <Checkbox
      :model-value="modelValue"
      :label="label"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<style lang="scss">
.launcher-toggles__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
