<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownOption } from '@/06-shared/types'
import SelectBase from './SelectBase.vue'

const props = withDefaults(defineProps<{
  options: DropdownOption[]
  modelValue: string
  width?: string
  maxVisible?: number
  disabled?: boolean
}>(), {
  maxVisible: 3,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const baseRef = ref<InstanceType<typeof SelectBase> | null>(null)

const selectedTitle = computed((): string => {
  const selected = props.options.find((option) => option.value === props.modelValue)
  return selected?.title ?? props.modelValue
})

function handleSelect(value: string): void {
  emit('update:modelValue', value)
  baseRef.value?.close()
}
</script>

<template>
  <SelectBase
    ref="baseRef"
    :options="props.options"
    :title="selectedTitle"
    :width="width"
    :max-visible="props.maxVisible"
    :disabled="props.disabled"
    @select="handleSelect"
  >
    <template #trailing>
      <slot name="trailing" />
    </template>
  </SelectBase>
</template>
