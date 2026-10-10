<script setup lang="ts">
import type { StepProgressItem } from '@/05-entities'

defineProps<{
  step: StepProgressItem
}>()
</script>

<template>
  <span v-if="step.status === 'active' && step.total > 0" class="step-progress__counter">
    {{ step.current }}/{{ step.total }}
  </span>
</template>
