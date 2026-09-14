<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  url: string
  isLoading: boolean
}>()

const emit = defineEmits<{
  get: []
  copy: []
}>()
</script>

<template>
  <div class="server-connect">
    <Button
      class="btn-secondary server-connect__btn"
      :is-disabled="isLoading"
      :is-loading="isLoading"
      @click="emit('get')"
    >
      Получить url для подключения сервера
    </Button>

    <div v-if="url" class="server-connect__result">
      <span class="server-connect__url">{{ url }}</span>
      <Button class="btn-secondary server-connect__copy" @click="emit('copy')">
        Скопировать
      </Button>
    </div>

    <p v-if="url" class="server-connect__hint">
      Отправьте ссылку игрокам — они добавят этот сервер через «Добавить профиль»
    </p>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.server-connect {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--element-gap);

  &__btn {
    width: 100%;
    max-width: var(--settings-row-width);
  }

  &__result {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    width: 100%;
    max-width: var(--settings-row-width);
    padding: var(--space-12);
    background: var(--surface-subtle);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-card);
  }

  &__url {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    word-break: break-all;
  }

  &__copy {
    flex-shrink: 0;
    min-height: var(--control-height);
    white-space: nowrap;
  }

  &__hint {
    @include mixins.caption-hint;

    max-width: var(--settings-row-width);
  }
}
</style>
