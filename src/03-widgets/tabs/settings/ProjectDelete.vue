<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'

const props = defineProps<{
  isDeleting?: boolean
}>()

const emit = defineEmits<{
  delete: []
}>()

const isDisabled = computed((): boolean => props.isDeleting ?? false)
</script>

<template>
  <Button
    class="btn-danger span-full project-delete__btn"
    :is-disabled="isDisabled"
    :is-loading="isDisabled"
    @click="emit('delete')"
  >
    Удалить проект
  </Button>
</template>

<style lang="scss">
.project-delete__btn {
  justify-self: center;
  width: 100%;
  max-width: var(--settings-row-width);
}
</style>
