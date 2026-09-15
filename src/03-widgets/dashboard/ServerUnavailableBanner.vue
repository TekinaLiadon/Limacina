<script setup lang="ts">
import { computed } from 'vue'
import { useCoreStore } from '@/05-entities'

const coreStore = useCoreStore()

const isVisible = computed((): boolean =>
  !coreStore.offlineBuild && coreStore.projectConfig?.online === true && coreStore.isServerReachable === false
)
</script>

<template>
  <div v-if="isVisible" class="server-unavailable-banner" role="alert">
    <span class="server-unavailable-banner__dot"></span>
    <span class="server-unavailable-banner__text">
      Сервер лаунчера недоступен — запуск и синхронизация файлов приостановлены. Мы продолжаем
      проверять соединение.
    </span>
  </div>
</template>

<style lang="scss">
.server-unavailable-banner {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-input);
  background: var(--delete-bg);
  color: var(--delete-text);
  font-size: var(--text-body-sm);
  line-height: var(--leading-body-sm);
  margin-bottom: var(--space-12);

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-circle);
    background: var(--delete-text);
    flex-shrink: 0;
  }

  &__text {
    min-width: 0;
  }
}
</style>
