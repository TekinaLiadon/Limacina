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

<style lang="scss">
.launch-scene {
  &__session {
    display: flex;
    align-items: center;
    gap: var(--space-16);
    margin-bottom: var(--title-gap);
    padding: var(--space-16);
    border-radius: var(--radius-card);
    background: var(--accent-subtle);
  }

  &__session-dot {
    width: var(--indicator-dot-size-lg);
    height: var(--indicator-dot-size-lg);
    border-radius: var(--radius-circle);
    background: var(--login-accent);
    flex-shrink: 0;
  }
}
</style>
