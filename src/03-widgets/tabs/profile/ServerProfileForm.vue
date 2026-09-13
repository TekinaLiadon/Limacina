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
@use '@/01-app/assets/mixins';
.server-profile {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  @include mixins.form-head;

  &__subtitle {
    @include mixins.form-subtitle;
  }

  &__error {
    @include mixins.error-box;

    margin: 0;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
}
</style>
