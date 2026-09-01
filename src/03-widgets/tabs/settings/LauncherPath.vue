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
    <span class="launcher-path__label eyebrow">Путь к лаунчеру</span>
    <div class="launcher-path__row">
      <Input
        :model-value="launcherPath"
        :options="{ placeholder: 'Путь не установлен', disabled: true }"
      />
      <Button class="btn-secondary launcher-path__browse-btn" @click="emit('browse')">
        Обзор
      </Button>
    </div>
  </div>
</template>

<style lang="scss">
.launcher-path {
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
    min-height: var(--control-height);
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
