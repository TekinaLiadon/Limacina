<script setup lang="ts">
import shigureGif from '@/06-shared/assets/shigure-ui-smol.gif'

defineProps<{
  visible: boolean
  direction: 'to-light' | 'to-dark'
}>()
</script>

<template>
  <Transition name="theme-switch">
    <div v-if="visible" class="theme-switch-overlay">
      <div class="theme-switch-girl" :class="`girl--${direction}`">
        <img :src="shigureGif" alt="" class="girl-gif" />
      </div>
    </div>
  </Transition>
</template>

<style lang="scss">
.theme-switch-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  pointer-events: none;
}

.theme-switch-girl {
  animation: girl-pop 1.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.girl--to-dark .girl-gif {
  filter: drop-shadow(0 4px 16px rgba(108, 127, 216, 0.5));
}

.girl--to-light .girl-gif {
  filter: invert(1) drop-shadow(0 4px 16px rgba(255, 255, 255, 0.4));
}

.girl-gif {
  width: 200px;
  height: auto;
  -webkit-mask-image: radial-gradient(circle, black 60%, transparent 100%);
  mask-image: radial-gradient(circle, black 60%, transparent 100%);
}

@keyframes girl-pop {
  0% {
    transform: scale(0.1) translateY(40px);
    opacity: 0;
  }
  10% {
    transform: scale(0.3) translateY(20px);
    opacity: 1;
  }
  30% {
    transform: scale(0.6) translateY(5px);
    opacity: 1;
  }
  50% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
  70% {
    transform: scale(1.5) translateY(-10px);
    opacity: 1;
  }
  85% {
    transform: scale(2.2) translateY(-20px);
    opacity: 0.8;
  }
  100% {
    transform: scale(3) translateY(-30px);
    opacity: 0;
  }
}

.theme-switch-enter-active,
.theme-switch-leave-active {
  transition: opacity 0.15s ease;
}

.theme-switch-enter-from,
.theme-switch-leave-to {
  opacity: 0;
}
</style>
