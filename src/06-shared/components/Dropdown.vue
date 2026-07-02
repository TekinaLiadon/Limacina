<script setup lang="ts">
import { computed, ref } from 'vue'
import DropdownOptions from '@/06-shared/components/DropdownOptions.vue'
import type { DropdownOption } from '@/06-shared/types'

const props = defineProps<{
  options: DropdownOption[]
  modelValue: string
  shown?: boolean
  width?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const shown = ref(false)
const data = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

</script>

<template>
  <div class="dropdown" :class="{ shown }">
    <div class="dropdown__value"
         @click="shown = !shown"
         :style="`width: ${width}`"
    >
      {{ props.modelValue }}
    </div>
    <DropdownOptions
        :options="props.options"
        v-model:shown="shown"
        :model-value="data"
        @update:model-value="(v: string) => emit('update:modelValue', v)"
        :style="`width: ${width}`" />
  </div>
</template>

<style lang="scss">
.dropdown {
  position: relative;
  cursor: pointer;

  &__value {
    border: 1px solid var(--login-border);
    border-radius: 10px;
    transition: border-radius 0.25s ease-out;
    height: 40px;
    align-content: center;
    padding: 0 14px;
    color: var(--login-text-primary);
    background-color: rgba(255, 255, 255, 0.06);
    font-size: 14px;
  }
}
.shown {
  .dropdown__value {
    border-radius: 10px 10px 0 0;
  }
}
</style>
