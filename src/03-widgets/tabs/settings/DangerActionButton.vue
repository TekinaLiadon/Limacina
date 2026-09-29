<script setup lang="ts">
import { Button } from '@/06-shared'

defineProps<{
  label: string
  isLoading?: boolean
}>()

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <Button
    class="btn-danger"
    :is-disabled="isLoading ?? false"
    :is-loading="isLoading ?? false"
    @click="emit('action')"
  >
    {{ label }}
  </Button>
</template>
