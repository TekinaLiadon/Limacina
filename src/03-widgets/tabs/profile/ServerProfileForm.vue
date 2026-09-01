<script setup lang="ts">
import { Button, Input } from '@/06-shared'
import type { ServerProfileForm as ServerForm } from '@/05-entities/core/types'

defineProps<{
  form: ServerForm
  isSubmitting: boolean
  isValid: boolean
  errorMessage: string
}>()

const emit = defineEmits<{
  submit: []
  back: []
}>()
</script>

<template>
  <div class="server-profile">
    <div class="server-profile__head">
      <h2 class="server-profile__title heading-display">Добавить сервер</h2>
      <p class="server-profile__subtitle">
        Введите адрес сервера — версия, сборка и моды загрузятся с него автоматически
      </p>
    </div>

    <Input
      :model-value="form.serverUrl"
      @update:model-value="form.serverUrl = $event"
      :options="{ label: 'Адрес сервера', placeholder: 'mc.example.com:3000' }"
    />

    <p v-if="errorMessage" class="server-profile__error">{{ errorMessage }}</p>

    <div class="server-profile__actions">
      <Button
        class="btn-primary btn-lg btn-block"
        :is-loading="isSubmitting"
        :is-disabled="!isValid"
        @click="emit('submit')"
      >
        Добавить
      </Button>
      <Button class="btn-quiet btn-block" @click="emit('back')">Назад</Button>
    </div>
  </div>
</template>

<style lang="scss">
.server-profile {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  &__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  &__title {
    font-size: var(--text-heading);
  }

  &__subtitle {
    margin: 0;
    font-size: var(--text-body-sm);
    color: var(--login-text-muted);
  }

  &__error {
    margin: 0;
    color: var(--error);
    font-size: var(--text-body-sm);
    padding: var(--space-12);
    background: var(--error-bg);
    box-shadow: inset 0 0 0 1px var(--error-border);
    border-radius: var(--radius-badge);
    word-break: break-word;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
}
</style>
