<script setup lang="ts">
import { Button, Input } from '@/06-shared'

defineProps<{
  launcherPath: string
}>()

const emit = defineEmits<{
  browse: []
}>()
</script>

<template>
  <div class="launcher-path">
    <span class="launcher-path__label">Путь к лаунчеру</span>
    <div class="launcher-path__row">
      <Input
        :model-value="launcherPath"
        :options="{ placeholder: 'Путь не установлен', disabled: true }"
      />
      <Button class="btn-yellow launcher-path__browse-btn" @click="emit('browse')">
        Обзор
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.launcher-path {
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
