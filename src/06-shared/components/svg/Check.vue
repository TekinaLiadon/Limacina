<script setup lang="ts">

</script>

<template>
  <svg class="checkbox__icon" viewBox="0 0 12 10" fill="none">
    <path d="M1 5L4.5 8.5L11 1" pathLength="16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</template>

<style lang="scss">
.checkbox__icon path {
  stroke-dasharray: 16;
  stroke-dashoffset: 16;
  animation: icon-check-draw var(--duration-base) var(--ease-out) forwards;
}

@keyframes icon-check-draw {
  to {
    stroke-dashoffset: 0;
  }
}
</style>
