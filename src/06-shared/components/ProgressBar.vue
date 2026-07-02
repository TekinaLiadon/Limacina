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
  gap: 12px;
  width: 100%;

  &__track {
    flex: 1;
    height: 8px;
    background: var(--grey-stroke);
    border-radius: 4px;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    background: linear-gradient(90deg, var(--login-accent), var(--login-accent-hover));
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  &__label {
    min-width: 40px;
    text-align: right;
    font-size: 13px;
    color: var(--login-text-secondary);
    font-variant-numeric: tabular-nums;
  }
}
</style>
