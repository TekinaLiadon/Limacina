<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  type?: string
  up?: boolean
  down?: boolean
  left?: boolean
  right?: boolean
}>(), {
  up: false,
  down: false,
  left: false,
  right: false,
})

const className = computed(() => ({
  'icon--up': props.up,
  'icon--down': props.down,
  'icon--left': props.left,
  'icon--right': props.right,
}))
</script>

<template>
  <i class="icon" :class="['icon-' + type, className]"></i>
</template>

<style lang="scss">
.icon {
  transition: all 0.2s;
  display: inline-block;

  &--up.icon {
    transform: rotate(0deg);
  }

  &--down.icon {
    transform: rotate(180deg);
  }

  &--left.icon {
    transform: rotate(-90deg);
  }

  &--right.icon {
    transform: rotate(90deg);
  }
}
</style>
