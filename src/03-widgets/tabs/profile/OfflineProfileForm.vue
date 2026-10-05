<script setup lang="ts">
import { Checkbox, Dropdown, Input, type DropdownOption } from '@/06-shared'
import ProfileFormShell from './ProfileFormShell.vue'
import type { OfflineProfileForm as OfflineForm } from '@/05-entities'

defineProps<{
  form: OfflineForm
  mcVersionOptions: DropdownOption[]
  loaderOptions: DropdownOption[]
  loaderVersionOptions: DropdownOption[]
  needsLoaderVersion: boolean
  isLoadingMcVersions: boolean
  isLoadingLoaderVersions: boolean
  isSubmitting: boolean
  isValid: boolean
  errorMessage: string
  canGoBack: boolean
}>()

const emit = defineEmits<{
  'update:form': [value: OfflineForm]
  submit: []
  back: []
}>()
</script>

<template>
  <ProfileFormShell
    title="Одиночная игра"
    subtitle="Локальный профиль: сервер не используется, файлы не синхронизируются"
    submit-label="Создать профиль"
    :is-submitting="isSubmitting"
    :is-valid="isValid"
    :error-message="errorMessage"
    :can-go-back="canGoBack"
    @submit="emit('submit')"
    @back="emit('back')"
  >
    <Input
      :model-value="form.name"
      @update:model-value="emit('update:form', { ...form, name: $event })"
      :options="{ label: 'Название профиля', placeholder: 'Например, Sandbox' }"
    />

    <div class="offline-profile__field">
      <span class="offline-profile__label">Версия Minecraft</span>
      <Dropdown
        :options="mcVersionOptions"
        :model-value="form.mcVersion"
        @update:model-value="emit('update:form', { ...form, mcVersion: $event })"
        :max-visible="6"
        :disabled="isLoadingMcVersions || mcVersionOptions.length === 0"
      />
      <Checkbox
        :model-value="form.includeSnapshots"
        @update:model-value="emit('update:form', { ...form, includeSnapshots: $event })"
        label="Показывать снапшоты"
      />
    </div>

    <div class="offline-profile__field">
      <span class="offline-profile__label">Загрузчик модов</span>
      <Dropdown
        :options="loaderOptions"
        :model-value="form.modLoader"
        @update:model-value="emit('update:form', { ...form, modLoader: $event as OfflineForm['modLoader'] })"
        :max-visible="4"
      />
    </div>

    <div v-if="needsLoaderVersion" class="offline-profile__field">
      <span class="offline-profile__label">Версия загрузчика</span>
      <Dropdown
        :options="loaderVersionOptions"
        :model-value="form.loaderVersion"
        @update:model-value="emit('update:form', { ...form, loaderVersion: $event })"
        :max-visible="6"
        :disabled="isLoadingLoaderVersions || loaderVersionOptions.length === 0"
      />
    </div>
  </ProfileFormShell>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.offline-profile__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.offline-profile__label {
  @include mixins.eyebrow;

  text-align: left;
}
</style>
