<script setup lang="ts">
import { computed } from 'vue'
import { Tooltip } from '@/06-shared'
import { useCoreStore } from '@/05-entities'

const coreStore = useCoreStore()

const isVisible = computed((): boolean => {
  if (!coreStore.serverStatus) return false
  return coreStore.projectConfig?.online !== false
})

const playersLabel = computed((): string => {
  const status = coreStore.serverStatus
  if (!status) return ''
  return `${status.online}/${status.max}`
})

const title = computed((): string => {
  const status = coreStore.serverStatus
  if (!status) return ''
  return `Игровой сервер доступен (${status.version})`
})
</script>

<template>
  <Tooltip v-if="isVisible" :content="title">
    <span class="server-status">
      <span class="server-status__dot"></span>
      <span class="server-status__players">{{ playersLabel }}</span>
    </span>
  </Tooltip>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.server-status {
  @include mixins.eyebrow($line-height: 1, $transform: none, $weight: null, $color: var(--login-text-secondary));

  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-family: var(--font-eyebrow);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  white-space: nowrap;

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-circle);
    background: var(--accent-text);
    flex-shrink: 0;
  }

  &__players {
    display: inline-flex;
    align-items: center;
  }
}
</style>
