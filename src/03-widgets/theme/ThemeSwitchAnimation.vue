<script setup lang="ts">
import shigureAnim from '@/01-app/assets/shigure-ui-smol.webp'

defineProps<{
  visible: boolean
  direction: 'to-light' | 'to-dark'
}>()
</script>

<template>
  <Transition name="theme-switch">
    <div v-if="visible" class="theme-switch-overlay">
      <div
        class="theme-switch-overlay__girl"
        :class="`theme-switch-overlay__girl--${direction}`"
      >
        <img :src="shigureAnim" alt="" class="theme-switch-overlay__girl-anim">
      </div>
    </div>
  </Transition>
</template>

<style lang="scss">
.theme-switch-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  pointer-events: none;
}

.theme-switch-overlay__girl {
  padding: var(--space-40);
  filter: drop-shadow(0 var(--switch-glow-offset) var(--switch-glow-blur) var(--switch-girl-glow));
  animation: theme-switch-girl-pop var(--switch-duration) cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.theme-switch-overlay__girl--to-dark {
  --switch-girl-glow: var(--switch-glow);
}

.theme-switch-overlay__girl--to-light {
  --switch-girl-glow: var(--switch-glow-invert);
}

.theme-switch-overlay__girl--to-dark .theme-switch-overlay__girl-anim {
  filter: brightness(0);
}

.theme-switch-overlay__girl--to-light .theme-switch-overlay__girl-anim {
  filter: brightness(0) invert(1);
}

.theme-switch-overlay__girl-anim {
  width: var(--theme-switch-size);
  height: auto;
}

@keyframes theme-switch-girl-pop {
  0% {
    transform: scale(0.2) translateY(var(--switch-girl-drop));
    opacity: 0;
    animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }
  15% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
  80% {
    transform: scale(1) translateY(0);
    opacity: 1;
    animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4);
  }
  100% {
    transform: scale(1.2) translateY(calc(-1 * var(--switch-girl-rise)));
    opacity: 0;
  }
}

.theme-switch-enter-active,
.theme-switch-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}

.theme-switch-enter-from,
.theme-switch-leave-to {
  opacity: 0;
}
</style>
