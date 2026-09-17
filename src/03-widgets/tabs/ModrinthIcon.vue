<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src: string | null
  title: string
  size?: 'sm' | 'lg'
}>(), {
  size: 'sm',
})

const isLoaded = ref(false)
const isFailed = ref(false)

const resolvedSrc = computed<string | null>(() => {
  const raw = props.src?.trim() ?? ''
  if (!raw) return null
  return raw.startsWith('//') ? `https:${raw}` : raw
})

watch(
  () => props.src,
  () => {
    isLoaded.value = false
    isFailed.value = false
  },
)
</script>

<template>
  <div class="modrinth-icon" :class="`modrinth-icon--${size}`">
    <span v-if="resolvedSrc === null || isFailed" class="modrinth-icon__fallback">
      {{ (title || '?').charAt(0).toUpperCase() }}
    </span>
    <img
      v-else
      class="modrinth-icon__img"
      :class="{ 'modrinth-icon__img--hidden': !isLoaded }"
      :src="resolvedSrc"
      :alt="title"
      @load="isLoaded = true"
      @error="isFailed = true"
    />
  </div>
</template>

<style lang="scss">
.modrinth-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-card);
  background: var(--surface-light);
  color: var(--login-text-muted);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
  overflow: hidden;

  &--sm {
    width: 48px;
    height: 48px;
  }

  &--lg {
    width: 56px;
    height: 56px;
    font-size: var(--text-heading-sm);
  }

  &__img {
    width: 100%;
    height: 100%;
    object-fit: cover;

    &--hidden {
      opacity: 0;
    }
  }
}
</style>
