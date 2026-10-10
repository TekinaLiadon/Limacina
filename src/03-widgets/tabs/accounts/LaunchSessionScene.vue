<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  sessionUsername: string
}>()

const emit = defineEmits<{
  minimize: []
}>()
</script>

<template>
  <div class="launch-scene__session">
    <span class="launch-scene__session-dot"></span>
    <div class="launch-scene__account-info">
      <span class="eyebrow">Игра запущена</span>
      <p class="launch-scene__name">{{ sessionUsername }}</p>
    </div>
  </div>
  <p class="launch-scene__hint">
    Лаунчер можно свернуть в трей — игра продолжит работать
  </p>
  <div class="launch-scene__actions">
    <Button class="btn-secondary btn-lg btn-block" @click="emit('minimize')">
      Свернуть в трей
    </Button>
  </div>
</template>
