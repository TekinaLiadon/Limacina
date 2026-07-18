<script setup lang="ts">
import { Button, Input } from '@/06-shared'

defineProps<{
  javaPath: string
}>()

const emit = defineEmits<{
  browse: []
}>()
</script>

<template>
  <div class="java-path-picker">
    <span class="java-path-picker__label">Путь к Java</span>
    <div class="java-path-picker__row">
      <Input
        :model-value="javaPath"
        :options="{ placeholder: 'Выберите папку', disabled: true }"
      />
      <Button class="btn-yellow java-path-picker__browse-btn" @click="emit('browse')">
        Обзор
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.java-path-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;

  &__label {
    font-size: 14px;
    color: var(--yellow);
    font-weight: 400;
  }

  &__row {
    display: flex;
    gap: 10px;
    align-items: flex-end;

    .input__core {
      flex: 1;
    }
  }

  &__browse-btn {
    height: 40px;
    padding: 0 20px;
    font-size: 13px;
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
