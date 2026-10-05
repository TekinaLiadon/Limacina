<script setup lang="ts">
import { Button } from '@/06-shared'

const props = withDefaults(defineProps<{
  title: string
  subtitle: string
  submitLabel: string
  isSubmitting: boolean
  isValid: boolean
  errorMessage: string
  canGoBack?: boolean
}>(), {
  canGoBack: false,
})

const emit = defineEmits<{
  submit: []
  back: []
}>()

const handleSubmit = (): void => {
  if (props.isSubmitting || !props.isValid) return
  emit('submit')
}
</script>

<template>
  <form class="profile-form" @submit.prevent="handleSubmit">
    <div class="profile-form__head">
      <h2 class="profile-form__title heading-display">{{ title }}</h2>
      <p class="profile-form__subtitle">{{ subtitle }}</p>
    </div>

    <slot />

    <p v-if="errorMessage" class="profile-form__error">{{ errorMessage }}</p>

    <div class="profile-form__actions">
      <Button
        class="btn-primary btn-lg btn-block"
        type="submit"
        :is-loading="isSubmitting"
        :is-disabled="!isValid"
      >
        {{ submitLabel }}
      </Button>
      <Button
        v-if="canGoBack"
        class="btn-quiet btn-block"
        @click="emit('back')"
      >Назад</Button>
    </div>
  </form>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.profile-form {
  display: flex;
  flex-direction: column;
  gap: var(--element-gap);

  @include mixins.form-head;
}
</style>
