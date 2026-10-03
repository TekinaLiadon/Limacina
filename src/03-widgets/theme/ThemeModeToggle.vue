<script setup lang="ts">
import { useThemeSettings } from '@/04-features'
import { Tooltip } from '@/06-shared'
import type { ThemeMode } from '@/05-entities'

interface ModeOption {
  value: ThemeMode
  label: string
  tooltip: string
}

withDefaults(defineProps<{
  variant?: 'icons' | 'labels'
}>(), {
  variant: 'labels',
})

const { currentMode, isSwitchDisabled, selectMode } = useThemeSettings()

const modes: ModeOption[] = [
  { value: 'dark', label: 'Тёмная', tooltip: 'Тёмная тема' },
  { value: 'light', label: 'Светлая', tooltip: 'Светлая тема' },
]
</script>

<template>
  <div class="theme-mode-toggle" :class="`theme-mode-toggle--${variant}`" role="group" aria-label="Режим темы">
    <Tooltip
      v-for="mode in modes"
      :key="mode.value"
      :content="mode.tooltip"
      :disabled="variant === 'labels'"
    >
      <button
        type="button"
        class="theme-mode-toggle__segment"
        :class="{ 'theme-mode-toggle__segment--active': currentMode === mode.value }"
        :disabled="isSwitchDisabled"
        :aria-pressed="currentMode === mode.value"
        :aria-label="variant === 'icons' ? mode.tooltip : undefined"
        @click="selectMode(mode.value)"
      >
        <svg v-if="variant === 'icons' && mode.value === 'dark'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <svg v-else-if="variant === 'icons'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <template v-else>{{ mode.label }}</template>
      </button>
    </Tooltip>
  </div>
</template>

<style lang="scss">
@use '@/01-app/assets/mixins';

.theme-mode-toggle {
  @include mixins.segmented;

  flex-shrink: 0;

  &__segment {
    border: none;
    font-family: inherit;
    cursor: pointer;
    transition: background-color var(--duration-base) var(--ease-out), color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out);
  }

  &--icons &__segment {
    @include mixins.segmented-item($hover-bg: false, $radius: var(--radius-circle));

    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
  }

  &--labels &__segment {
    @include mixins.segmented-item($hover-bg: false);
    @include mixins.mode-toggle;

    padding: var(--space-4) var(--space-16);
  }
}
</style>
