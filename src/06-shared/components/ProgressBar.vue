<script setup lang="ts">
import { ref, watch } from 'vue'
import anime from 'animejs'

const props = withDefaults(defineProps<{
  progress: number
  animated?: boolean
}>(), {
  animated: true,
})

const fillRef = ref<HTMLDivElement | null>(null)

watch(() => props.progress, (val: number) => {
  if (props.animated && fillRef.value) {
    anime({
      targets: fillRef.value,
      width: `${Math.min(100, Math.max(0, val))}%`,
      duration: 600,
      easing: 'easeInOutQuad',
    })
  }
}, { immediate: true })
</script>

<template>
  <div class="progress-bar">
    <div class="progress-bar__track">
      <div
        ref="fillRef"
        class="progress-bar__fill"
        :style="{ width: `${Math.min(100, Math.max(0, progress))}%` }"
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
    height: 100%;
    background: linear-gradient(90deg, var(--login-accent), var(--login-accent-hover));
    border-radius: var(--radius-pill);
    transition: width 0.3s ease;
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
</style>
