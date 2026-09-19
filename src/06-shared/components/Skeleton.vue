<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'line' | 'list-item' | 'card'
  lines?: number
  iconShape?: 'circle' | 'square'
  width?: string
  height?: string
}>(), {
  variant: 'line',
  lines: 2,
  iconShape: 'circle',
  width: '',
  height: '',
})

const lineIndexes = computed((): number[] =>
  Array.from({ length: Math.max(1, props.lines) }, (_, index) => index + 1),
)

const rootStyle = computed((): Record<string, string> => {
  const style: Record<string, string> = {}
  if (props.width) style.width = props.width
  if (props.height && props.variant !== 'list-item') style.height = props.height
  return style
})
</script>

<template>
  <span
    class="skeleton"
    :class="`skeleton--${props.variant}`"
    :style="rootStyle"
    aria-hidden="true"
  >
    <template v-if="props.variant === 'list-item'">
      <span
        class="skeleton__icon"
        :class="`skeleton__icon--${props.iconShape}`"
      />
      <span class="skeleton__body">
        <span
          v-for="index in lineIndexes"
          :key="index"
          class="skeleton__line"
          :class="{ 'skeleton__line--short': index === lineIndexes.length }"
        />
      </span>
    </template>
    <span v-else class="skeleton__line" />
  </span>
</template>

<style lang="scss">
.skeleton {
  display: block;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-badge);
  background: var(--surface-subtle);
  box-shadow: var(--elevation-inset);

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translate(-100%, -100%);
    background: linear-gradient(135deg, transparent 25%, var(--surface-hover) 50%, transparent 75%);
    animation: skeleton-shimmer var(--duration-shimmer) ease infinite;
  }

  &__icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    background: var(--surface-light);

    &--circle {
      border-radius: var(--radius-circle);
    }

    &--square {
      border-radius: var(--radius-button);
    }
  }

  &__body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-8);
    flex: 1;
    min-width: 0;
  }

  &__line {
    display: block;
    height: calc(var(--text-body-sm) * var(--leading-body-sm));
    width: 100%;
    border-radius: var(--radius-badge);
    background: var(--surface-light);

    &--short {
      width: 60%;
    }
  }

  &--line {
    height: calc(var(--text-body-sm) * var(--leading-body-sm));
  }

  &--card {
    height: 96px;
  }

  &--list-item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-8) var(--space-12);
    border-radius: var(--radius-card);
  }
}

@keyframes skeleton-shimmer {
  to {
    transform: translate(100%, 100%);
  }
}
</style>
