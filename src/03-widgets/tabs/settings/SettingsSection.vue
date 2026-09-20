<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cssDurationMs } from '@/06-shared'

const props = withDefaults(defineProps<{
  title: string
  storageKey?: string
}>(), {
  storageKey: '',
})

const isOpen = ref<boolean>(true)
const isAnimating = ref<boolean>(false)
const bodyRef = ref<HTMLElement | null>(null)
let clipTimer: ReturnType<typeof setTimeout> | undefined

const isCollapsible = computed((): boolean => props.storageKey !== '')
const shouldClip = computed((): boolean => !isOpen.value || isAnimating.value)

onMounted((): void => {
  if (isCollapsible.value && localStorage.getItem(`limacina-section-${props.storageKey}`) === '0') {
    isOpen.value = false
  }
})

const clearAnimating = (): void => {
  isAnimating.value = false
  clearTimeout(clipTimer)
}

const toggle = (): void => {
  isOpen.value = !isOpen.value
  if (isCollapsible.value) {
    localStorage.setItem(`limacina-section-${props.storageKey}`, isOpen.value ? '1' : '0')
  }
  isAnimating.value = true
  clearTimeout(clipTimer)
  clipTimer = setTimeout(
    clearAnimating,
    cssDurationMs('--duration-base', 250) + 100,
  )
}

const handleTransitionEnd = (e: TransitionEvent): void => {
  if (e.target !== bodyRef.value || e.propertyName !== 'grid-template-rows') return
  clearAnimating()
}

onBeforeUnmount((): void => {
  clearTimeout(clipTimer)
})
</script>

<template>
  <section class="settings-section">
    <button
      v-if="isCollapsible"
      type="button"
      class="settings-section__head"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <span class="settings-section__title">{{ title }}</span>
      <svg
        class="settings-section__chevron"
        :class="{ 'settings-section__chevron--open': isOpen }"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span v-else class="settings-section__title">{{ title }}</span>

    <div
      ref="bodyRef"
      class="settings-section__body"
      :class="{ 'settings-section__body--closed': isCollapsible && !isOpen }"
      @transitionend="handleTransitionEnd"
    >
      <div class="settings-section__inner" :class="{ 'settings-section__inner--clip': shouldClip }">
        <slot />
      </div>
    </div>
  </section>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.settings-section {
  display: flex;
  flex-direction: column;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    width: 100%;
    padding: var(--space-8) 0;
    border: none;
    background: transparent;
    font-family: inherit;
    cursor: pointer;
    margin-bottom: var(--space-8);

    &:hover .settings-section__title {
      color: var(--login-text-secondary);
    }
  }

  &__title {
    @include mixins.eyebrow(var(--text-body-sm), var(--leading-body-sm));

    font-family: var(--font-eyebrow);
    white-space: nowrap;
    font-feature-settings: "tnum" on;
    transition: color var(--duration-base) var(--ease-out);
  }

  &__chevron {
    flex-shrink: 0;
    color: var(--login-text-muted);
    transition: transform var(--duration-base) var(--ease-out);

    &--open {
      transform: rotate(180deg);
    }
  }

  &__body {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows var(--duration-base) var(--ease-in-out), opacity var(--duration-base) var(--ease-out), visibility var(--duration-base);

    &--closed {
      grid-template-rows: 0fr;
      opacity: 0;
      visibility: hidden;
    }
  }

  &__inner {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--section-gap);

    &--clip {
      overflow: hidden;
    }
  }
}
</style>
