<script setup lang="ts">
import { Skeleton } from '@/06-shared'

withDefaults(defineProps<{
  lines?: number
}>(), {
  lines: 6,
})
</script>

<template>
  <div class="game-options-skeleton">
    <Skeleton
      v-for="index in lines"
      :key="index"
      variant="line"
      height="var(--control-height)"
      aria-hidden="true"
    />
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.game-options-skeleton {
  @include mixins.settings-fields-grid;
}
</style>
