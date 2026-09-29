<script setup lang="ts">
import { Button } from '@/06-shared'

withDefaults(defineProps<{
  message: string
  showSetup?: boolean
}>(), {
  showSetup: false,
})

const emit = defineEmits<{
  retry: []
  setup: []
}>()
</script>

<template>
  <div class="startup-error">
    <div class="startup-error__card">
      <span class="eyebrow">Ошибка запуска</span>
      <h1 class="startup-error__title">Не удалось загрузить данные лаунчера</h1>
      <p class="startup-error__message">{{ message }}</p>
      <div class="startup-error__actions">
        <Button class="btn-primary btn-lg btn-block" @click="emit('retry')">
          Повторить
        </Button>
        <Button v-if="showSetup" class="btn-secondary btn-block" @click="emit('setup')">
          Настроить лаунчер
        </Button>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.startup-error {
  @include mixins.fullscreen-page;
}

.startup-error__card {
  @include mixins.fullscreen-card;

  max-width: var(--page-max-width);
  position: relative;
  z-index: var(--z-content);

  .eyebrow {
    display: block;
    margin-bottom: var(--space-12);
  }
}

.startup-error__title {
  font-size: var(--text-heading);
  margin: 0 0 var(--space-12) 0;
}

.startup-error__message {
  margin: 0 0 var(--title-gap) 0;
  font-size: var(--text-body-sm);
  line-height: var(--leading-body-sm);
  color: var(--error);
  word-break: break-word;
}

.startup-error__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
</style>
