<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import anime from 'animejs'
import { cssDurationMs, isAnimationsEnabled } from '@/06-shared/utils/animations'

const props = withDefaults(defineProps<{
  progress: number
  animated?: boolean
}>(), {
  animated: true,
})

const fillRef = ref<HTMLDivElement | null>(null)

const clampedScale = (): number => Math.min(100, Math.max(0, props.progress)) / 100

const isIdle = computed((): boolean => props.progress <= 0 || props.progress >= 100)

const applyScale = (): void => {
  if (fillRef.value) fillRef.value.style.transform = `scaleX(${clampedScale()})`
}

watch(() => props.progress, (): void => {
  if (fillRef.value === null) return
  if (!props.animated || !isAnimationsEnabled()) {
    applyScale()
    return
  }
  anime({
    targets: fillRef.value,
    scaleX: clampedScale(),
    duration: cssDurationMs('--duration-base', 250),
    easing: 'easeInOutQuad',
  })
})

onMounted(applyScale)
</script>

<template>
  <div class="progress-bar">
    <div class="progress-bar__track">
      <div
        ref="fillRef"
        class="progress-bar__fill"
        :class="{ 'progress-bar__fill--idle': isIdle }"
      />
    </div>
    <span class="progress-bar__label">{{ Math.round(progress) }}%</span>
  </div>
</template>

<style lang="scss">
.progress-bar {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  width: 100%;

  &__track {
    flex: 1;
    height: 6px;
    background: var(--surface-active);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }

  &__fill {
    position: relative;
    width: 100%;
    height: 100%;
    transform: scaleX(0);
    transform-origin: left;
    background: linear-gradient(90deg, var(--login-accent), var(--login-accent-hover));
    border-radius: var(--radius-pill);
    overflow: hidden;

    &::after {
      content: '';
      position: absolute;
      inset: 0;
      transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, var(--text-on-accent), transparent);
      opacity: 0.3;
      animation: progress-bar-shimmer var(--duration-shimmer) var(--ease-in-out) infinite;
    }

    &--idle::after {
      content: none;
    }
  }

  &__label {
    min-width: 40px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    color: var(--login-text-secondary);
    font-variant-numeric: tabular-nums;
  }
}

@keyframes progress-bar-shimmer {
  to {
    transform: translateX(100%);
  }
}
</style>
