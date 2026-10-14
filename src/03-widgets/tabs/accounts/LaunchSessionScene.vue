<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'

const props = defineProps<{
  sessionUsernames: string[]
}>()

const emit = defineEmits<{
  back: []
}>()

const sessionEyebrow = computed((): string =>
  props.sessionUsernames.length > 1
    ? `Игры запущены (${props.sessionUsernames.length})`
    : 'Игра запущена',
)
</script>

<template>
  <div class="launch-scene__session">
    <span class="launch-scene__session-dot"></span>
    <div class="launch-scene__account-info">
      <span class="eyebrow">{{ sessionEyebrow }}</span>
      <p
        v-for="name in sessionUsernames"
        :key="name"
        class="launch-scene__name"
      >
        {{ name }}
      </p>
    </div>
  </div>
  <div class="launch-scene__actions">
    <Button class="btn-secondary btn-lg btn-block" @click="emit('back')">
      Назад к аккаунтам
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
