<script setup lang="ts">
import { Button } from '@/06-shared'

withDefaults(defineProps<{
  message?: string
  isLoading?: boolean
}>(), {
  message: '',
  isLoading: false,
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="message" class="load-error-row" role="alert">
    <p class="load-error-row__text">{{ message }}</p>
    <Button
      class="btn-secondary load-error-row__btn"
      :is-loading="isLoading ?? false"
      :is-disabled="isLoading ?? false"
      @click="$emit('retry')"
    >
      Повторить
    </Button>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.load-error-row {
  @include mixins.load-error-row;

  &__text {
    margin: 0;
  }

  &__btn {
    flex-shrink: 0;
  }
}
</style>
