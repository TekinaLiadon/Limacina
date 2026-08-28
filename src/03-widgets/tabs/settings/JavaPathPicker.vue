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
    <span class="java-path-picker__label eyebrow">Путь к Java</span>
    <div class="java-path-picker__row">
      <Input
        :model-value="javaPath"
        :options="{ placeholder: 'Выберите папку', disabled: true }"
      />
      <Button class="btn-secondary java-path-picker__browse-btn" @click="emit('browse')">
        Обзор
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.java-path-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  &__row {
    display: flex;
    gap: var(--space-8);
    align-items: center;

    .input__core {
      flex: 1;
    }
  }

  &__browse-btn {
    min-height: 40px;
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
