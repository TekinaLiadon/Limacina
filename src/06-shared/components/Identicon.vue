<script setup lang="ts">
import { computed } from 'vue'
import { generateIdenticon } from '../utils/identicon'

const props = defineProps<{
  username: string
  size: number
}>()

const src = computed((): string => generateIdenticon(props.username))
</script>

<template>
  <img
    class="identicon"
    :src="src"
    alt=""
    :style="{ width: `${size}px`, height: `${size}px` }"
  >
</template>

<style lang="scss">
.identicon {
  display: block;
  flex-shrink: 0;
  border-radius: var(--radius-circle);
  image-rendering: pixelated;
}
</style>
