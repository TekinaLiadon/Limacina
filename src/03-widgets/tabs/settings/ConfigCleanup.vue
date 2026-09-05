<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/06-shared'

const props = defineProps<{
  isClearing?: boolean
}>()

const emit = defineEmits<{
  clear: []
}>()

const isDisabled = computed((): boolean => props.isClearing ?? false)
</script>

<template>
  <Button
    class="btn-secondary"
    :is-disabled="isDisabled"
    :is-loading="isClearing"
    @click="emit('clear')"
  >
    Очистить конфиги игры
  </Button>
</template>
