<script setup lang="ts">
import { ModrinthTab } from '@/03-widgets'
</script>

<template>
  <div class="mods-page">
    <ModrinthTab />
  </div>
</template>

<style lang="scss">
.mods-page {
  width: 100%;
  padding: var(--page-padding-y) var(--page-padding-x);
  display: flex;
  flex-direction: column;
  height: 100%;
  text-align: left;
}
</style>
