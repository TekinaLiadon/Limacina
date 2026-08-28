<script setup lang="ts">
import { computed } from 'vue'
import { Checkbox, Input } from '@/06-shared'

const props = defineProps<{
  modelValue: number | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const isEnabled = computed({
  get: (): boolean => props.modelValue !== null,
  set: (val: boolean): void => {
    emit('update:modelValue', val ? 0 : null)
  },
})

const speedValue = computed({
  get: (): string => {
    return props.modelValue !== null ? String(props.modelValue) : ''
  },
  set: (val: string): void => {
    const num = parseInt(val, 10)
    emit('update:modelValue', isNaN(num) || num <= 0 ? null : num)
  },
})
</script>

<template>
  <div class="speed-limit">
    <Checkbox
      v-model="isEnabled"
      label="Ограничение скорости скачивания"
    />
    <div v-if="isEnabled" class="speed-limit__row">
      <Input
        v-model="speedValue"
        :options="{ placeholder: '0' }"
      />
      <span class="speed-limit__unit">МБ/с</span>
    </div>
  </div>
</template>

<style lang="scss">
.speed-limit {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;

  &__row {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    margin-top: var(--space-8);

    .input__core {
      max-width: 120px;
    }
  }

  &__unit {
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
    white-space: nowrap;
  }
}
</style>
