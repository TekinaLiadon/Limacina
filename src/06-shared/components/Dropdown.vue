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
  openUp?: boolean
}>(), {
  maxVisible: 3,
  disabled: false,
  openUp: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const baseRef = ref<InstanceType<typeof SelectBase> | null>(null)

const selectedTitle = computed((): string => {
  const value = String(props.modelValue)
  const selected = props.options.find((option) => String(option.value) === value)
  return selected?.title ?? value
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
    :open-up="props.openUp"
    @select="handleSelect"
  >
    <template #trailing>
      <slot name="trailing" />
    </template>
  </SelectBase>
</template>
