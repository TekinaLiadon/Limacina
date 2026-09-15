<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '@/05-entities'

const props = withDefaults(defineProps<{
  title: string
  storageKey?: string
}>(), {
  storageKey: '',
})

const settingsStore = useSettingsStore()
const isOpen = ref<boolean>(true)

const isCollapsible = computed((): boolean => props.storageKey !== '')

onMounted((): void => {
  if (isCollapsible.value && localStorage.getItem(`limacina-section-${props.storageKey}`) === '0') {
    isOpen.value = false
  }
})

const toggle = (): void => {
  isOpen.value = !isOpen.value
  if (isCollapsible.value) {
    localStorage.setItem(`limacina-section-${props.storageKey}`, isOpen.value ? '1' : '0')
  }
}

const bodyStyle = computed((): Record<string, string> =>
  settingsStore.animationsEnabled ? {} : { transition: 'none' },
)
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
      class="settings-section__body"
      :class="{ 'settings-section__body--closed': isCollapsible && !isOpen }"
      :style="bodyStyle"
    >
      <div class="settings-section__inner">
        <slot />
      </div>
    </div>
  </section>
</template>

<style lang="scss">
.settings-section {
  display: flex;
  flex-direction: column;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    font-family: inherit;
    cursor: pointer;
    margin-bottom: var(--space-16);

    &:hover .settings-section__title {
      color: var(--login-text-secondary);
    }
  }

  &__title {
    font-family: var(--font-eyebrow);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--login-text-muted);
    white-space: nowrap;
    font-feature-settings: "tnum" on;
    transition: color 0.2s ease;
  }

  &__chevron {
    flex-shrink: 0;
    color: var(--login-text-muted);
    transition: transform 0.2s ease;

    &--open {
      transform: rotate(180deg);
    }
  }

  &__body {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.3s ease;

    &--closed {
      grid-template-rows: 0fr;
    }
  }

  &__inner {
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--section-gap);
  }
}
</style>
