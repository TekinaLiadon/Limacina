<script setup lang="ts">
import { computed } from 'vue'
import { generateIdenticon } from '@/06-shared'

const props = defineProps<{
  username: string
  size: 'sm' | 'lg'
}>()

const src = computed((): string => generateIdenticon(props.username))
</script>

<template>
  <img
    v-if="src"
    class="identicon"
    :class="`identicon--${size}`"
    :src="src"
    alt=""
  >
</template>

<style lang="scss">
.identicon {
  display: block;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  image-rendering: pixelated;

  &--sm {
    width: var(--avatar-size-sm);
    height: var(--avatar-size-sm);
  }

  &--lg {
    width: var(--avatar-size-lg);
    height: var(--avatar-size-lg);
  }
}
</style>
