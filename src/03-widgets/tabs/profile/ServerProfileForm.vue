<script setup lang="ts">
import { Input } from '@/06-shared'
import ProfileFormShell from './ProfileFormShell.vue'
import type { ServerProfileForm as ServerForm } from '@/05-entities'

withDefaults(defineProps<{
  form: ServerForm
  isSubmitting: boolean
  isValid: boolean
  errorMessage: string
  canGoBack?: boolean
}>(), {
  canGoBack: false,
})

const emit = defineEmits<{
  'update:form': [value: ServerForm]
  submit: []
  back: []
}>()
</script>

<template>
  <ProfileFormShell
    title="Добавить сервер"
    subtitle="Введите адрес сервера — версия, сборка и моды загрузятся с него автоматически"
    submit-label="Добавить"
    :is-submitting="isSubmitting"
    :is-valid="isValid"
    :error-message="errorMessage"
    :can-go-back="canGoBack ?? false"
    @submit="emit('submit')"
    @back="emit('back')"
  >
    <Input
      :model-value="form.serverUrl"
      @update:model-value="emit('update:form', { ...form, serverUrl: $event })"
      :options="{ label: 'Адрес сервера', placeholder: 'mc.example.com:3000' }"
    />
  </ProfileFormShell>
</template>
