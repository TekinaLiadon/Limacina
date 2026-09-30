<script setup lang="ts">
defineProps<{
  label: string
  icon?: 'plus' | 'minus'
}>()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <button class="tool-icon-button" :aria-label="label" @click="emit('click')">
    <svg v-if="icon === 'plus'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
    <svg v-else-if="icon === 'minus'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
    <slot v-else />
  </button>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.tool-icon-button {
  @include mixins.tool-button;

  flex-shrink: 0;
}
</style>
