<script setup lang="ts">
import CpmSettings from './CpmSettings.vue'
import PresetGallery from './PresetGallery.vue'
</script>

<template>
  <div class="model-tab">
    <PresetGallery />

    <section class="model-tab__own">
      <div class="model-tab__own-title section-label">Своя модель (.cpmproject)</div>
      <CpmSettings />
    </section>
  </div>
</template>

<style lang="scss">
.model-tab {
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);

  &__own {
    display: flex;
    flex-direction: column;
    gap: var(--element-gap);
  }

  &__own-title {
    text-align: left;
  }
}
</style>
