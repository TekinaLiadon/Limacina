<script setup lang="ts">
import { ref, watch } from 'vue'
import { Input } from '@/06-shared'

const props = defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const localValue = ref<string>(String(props.modelValue))

watch(() => props.modelValue, (value: number) => {
  localValue.value = String(value)
})

const onInput = (value: string): void => {
  localValue.value = value
}

const onCommit = (): void => {
  const parsed = Number(localValue.value)
  if (!Number.isFinite(parsed)) {
    localValue.value = String(props.modelValue)
    return
  }
  const clamped = Math.min(Math.max(parsed, props.min), props.max)
  emit('update:modelValue', clamped)
}
</script>

<template>
  <div class="game-number-field">
    <span class="game-number-field__text">{{ label }}</span>
    <Input
      class="game-number-field__control"
      :model-value="localValue"
      :options="{ type: 'number' }"
      @update:model-value="onInput"
      @change="onCommit"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-number-field {
  @include mixins.settings-row-body;

  &__control {
    flex-shrink: 0;
    width: 110px;
  }
}
</style>
