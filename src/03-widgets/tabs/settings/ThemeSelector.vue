<script setup lang="ts">
import { useThemeSettings } from '@/04-features'
import type { ThemeMode } from '@/05-entities'

interface ModeOption {
  value: ThemeMode
  label: string
}

const {
  families,
  currentFamily,
  currentMode,
  isSwitchDisabled,
  previewOf,
  selectFamily,
  selectMode,
} = useThemeSettings()

const modes: ModeOption[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
]
</script>

<template>
  <div class="theme-selector">
    <div class="theme-selector__head">
      <span class="theme-selector__label eyebrow">Тема оформления</span>

      <div class="theme-selector__modes" role="group" aria-label="Режим темы">
        <button
          v-for="mode in modes"
          :key="mode.value"
          type="button"
          class="theme-selector__mode"
          :class="{ 'theme-selector__mode--active': currentMode === mode.value }"
          :disabled="isSwitchDisabled"
          :aria-pressed="currentMode === mode.value"
          @click="selectMode(mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>

    <div class="theme-selector__list" role="radiogroup" aria-label="Тема оформления">
      <button
        v-for="family in families"
        :key="family.id"
        type="button"
        role="radio"
        class="theme-selector__item"
        :class="{ 'theme-selector__item--active': currentFamily === family.id }"
        :aria-checked="currentFamily === family.id"
        :disabled="isSwitchDisabled"
        @click="selectFamily(family.id)"
      >
        <span class="theme-selector__swatches" aria-hidden="true">
          <span
            class="theme-selector__swatch"
            :style="{ background: previewOf(family).bg }"
          />
          <span
            class="theme-selector__swatch"
            :style="{ background: previewOf(family).surface }"
          />
          <span
            class="theme-selector__swatch theme-selector__swatch--accent"
            :style="{ background: previewOf(family).accent }"
          />
        </span>

        <span class="theme-selector__info">
          <span class="theme-selector__name">{{ family.title }}</span>
          <span class="theme-selector__desc">{{ family.description }}</span>
        </span>

        <span class="theme-selector__check" aria-hidden="true">
          <svg viewBox="0 0 12 10" fill="none" width="12" height="10">
            <path
              d="M1 5L4.5 8.5L11 1"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  </div>
</template>

<style lang="scss">
.theme-selector {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  &__modes {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--surface-light);
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-pill);
  }

  &__mode {
    padding: var(--space-4) var(--space-16);
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--login-text-muted);
    font-family: inherit;
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;

    &:hover:not(:disabled) {
      color: var(--login-text-primary);
    }

    &--active {
      background: var(--surface-active);
      box-shadow: var(--elevation-inset);
      color: var(--login-text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    width: 100%;
    padding: var(--space-12);
    text-align: left;
    background: var(--surface-subtle);
    border: none;
    box-shadow: var(--elevation-inset);
    border-radius: var(--radius-card);
    color: var(--login-text-primary);
    font-family: inherit;
    cursor: pointer;
    transition: background 0.2s ease, box-shadow 0.2s ease;

    &:hover:not(:disabled) {
      background: var(--surface-hover);
      box-shadow: var(--elevation-inset-strong);
    }

    &--active {
      background: var(--accent-subtle);
      box-shadow: inset 0 0 0 1px var(--login-accent);

      .theme-selector__check {
        opacity: 1;
      }
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__swatches {
    display: flex;
    flex-shrink: 0;
    padding: var(--space-4);
    gap: var(--space-4);
    border-radius: var(--radius-pill);
    box-shadow: var(--elevation-inset);
  }

  &__swatch {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-circle);
    box-shadow: var(--elevation-inset);

    &--accent {
      box-shadow: var(--elevation-inset), var(--elevation-glow);
    }
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  &__name {
    font-size: var(--text-body-sm);
    font-weight: var(--weight-medium);
    color: var(--login-text-primary);
  }

  &__desc {
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--login-text-muted);
  }

  &__check {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-circle);
    background: var(--login-accent);
    color: var(--text-on-accent);
    opacity: 0;
    transition: opacity 0.2s ease;
  }
}
</style>
