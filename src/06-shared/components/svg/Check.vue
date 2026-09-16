<script setup lang="ts">

</script>

<template>
  <svg class="check-icon" viewBox="0 0 12 10" fill="none">
    <path d="M1 5L4.5 8.5L11 1" pathLength="16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</template>

<style lang="scss">
.check-icon {
  width: 12px;
  height: 10px;
  color: var(--text-on-accent);
  flex-shrink: 0;
}

.check-icon path {
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
