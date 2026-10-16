<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  isInstalled: boolean
  updateVersion: string
  isBusy: boolean
  isBusyAny: boolean
}>()

const emit = defineEmits<{
  update: []
  install: []
}>()
</script>

<template>
  <Button
    v-if="updateVersion"
    class="btn-primary"
    :is-loading="isBusy"
    :is-disabled="isBusyAny"
    @click="emit('update')"
  >
    Обновить
  </Button>
  <Button
    v-else-if="!isInstalled"
    class="btn-primary"
    :is-loading="isBusy"
    :is-disabled="isBusyAny"
    @click="emit('install')"
  >
    Скачать
  </Button>
  <span v-else class="modrinth-install-actions__badge">Установлен</span>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-install-actions__badge {
  @include mixins.badge($color: var(--accent-text));

  flex-shrink: 0;
}
</style>
