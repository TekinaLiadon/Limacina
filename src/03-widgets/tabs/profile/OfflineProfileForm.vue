<script setup lang="ts">
import { Button, Checkbox, Dropdown, Input } from '@/06-shared'
import type { DropdownOption } from '@/06-shared/types'
import type { OfflineProfileForm as OfflineForm } from '@/05-entities/core/types'

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
}>()

const emit = defineEmits<{
  submit: []
  back: []
}>()
</script>

<template>
  <div class="offline-profile">
    <div class="offline-profile__head">
      <h2 class="offline-profile__title heading-display">Одиночная игра</h2>
      <p class="offline-profile__subtitle">
        Локальный профиль: сервер не используется, файлы не синхронизируются
      </p>
    </div>

    <Input
      :model-value="form.name"
      @update:model-value="form.name = $event"
      :options="{ label: 'Название профиля', placeholder: 'Например, Sandbox' }"
    />

    <div class="offline-profile__field">
      <span class="offline-profile__label">Версия Minecraft</span>
      <Dropdown
        :options="mcVersionOptions"
        :model-value="form.mcVersion"
        @update:model-value="form.mcVersion = $event"
        :max-visible="6"
        :disabled="isLoadingMcVersions || mcVersionOptions.length === 0"
      />
      <Checkbox
        :model-value="form.includeSnapshots"
        @update:model-value="form.includeSnapshots = $event"
        label="Показывать снапшоты"
      />
    </div>

    <div class="offline-profile__field">
      <span class="offline-profile__label">Загрузчик модов</span>
      <Dropdown
        :options="loaderOptions"
        :model-value="form.modLoader"
        @update:model-value="form.modLoader = $event as OfflineForm['modLoader']"
        :max-visible="4"
      />
    </div>

    <div v-if="needsLoaderVersion" class="offline-profile__field">
      <span class="offline-profile__label">Версия загрузчика</span>
      <Dropdown
        :options="loaderVersionOptions"
        :model-value="form.loaderVersion"
        @update:model-value="form.loaderVersion = $event"
        :max-visible="6"
        :disabled="isLoadingLoaderVersions || loaderVersionOptions.length === 0"
      />
    </div>

    <p v-if="errorMessage" class="offline-profile__error">{{ errorMessage }}</p>

    <div class="offline-profile__actions">
      <Button
        class="btn-primary btn-lg btn-block"
        :is-loading="isSubmitting"
        :is-disabled="!isValid"
        @click="emit('submit')"
      >
        Создать профиль
      </Button>
      <Button class="btn-quiet btn-block" @click="emit('back')">Назад</Button>
    </div>
  </div>
</template>

<style lang="scss">
.offline-profile {
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

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__label {
    color: var(--login-text-muted);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    text-align: left;
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
