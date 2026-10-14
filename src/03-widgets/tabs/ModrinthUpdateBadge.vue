<script setup lang="ts">
defineProps<{
  version: string
}>()
</script>

<template>
  <span class="modrinth-update-badge">Доступно: {{ version }}</span>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.modrinth-update-badge {
  @include mixins.badge;

  color: var(--accent-text);
}
</style>
