<script setup lang="ts">
import { ModrinthTab } from '@/03-widgets'
</script>

<template>
  <div class="mods-page">
    <ModrinthTab />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.mods-page {
  @include mixins.page-scaffold(none);

  text-align: left;
}
</style>
