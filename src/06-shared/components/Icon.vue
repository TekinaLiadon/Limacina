<script setup>
import { computed } from "vue";

const props = defineProps({
  type: {
    type: String,
  },
  up: Boolean,
  down: Boolean,
  left: Boolean,
  right: Boolean,
});

const className = computed(() => ({
  "icon--up": props.up,
  "icon--down": props.down,
  "icon--left": props.left,
  "icon--right": props.right,
}));
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
