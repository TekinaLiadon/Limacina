<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  src: string | null
  title: string
  size?: 'sm' | 'lg'
}>(), {
  size: 'sm',
})

const isLoaded = ref(false)
const isFailed = ref(false)

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
    <span v-if="src === null || isFailed" class="modrinth-icon__fallback">
      {{ (title || '?').charAt(0).toUpperCase() }}
    </span>
    <img
      v-else
      class="modrinth-icon__img"
      :class="{ 'modrinth-icon__img--hidden': !isLoaded }"
      :src="src"
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
  font-weight: var(--weight-semibold);
  flex-shrink: 0;
  overflow: hidden;

  &--sm {
    width: 48px;
    height: 48px;
  }

  &--lg {
    width: 56px;
    height: 56px;
    font-size: var(--text-title);
  }

  &__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: opacity 0.2s ease;

    &--hidden {
      opacity: 0;
    }
  }
}
</style>
