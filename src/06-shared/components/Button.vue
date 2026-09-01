<script setup lang="ts">
const props = defineProps<{
  label?: string
  isDisabled?: boolean
  isLoading?: boolean
}>()

</script>

<template>
  <button class="btn" :aria-label="props.label" :class="{
      disabled: isDisabled,
      loading: isLoading,
    }"
    :aria-busy="isLoading"
  >
    <span v-if="isLoading" class="btn__spinner" aria-hidden="true" />
    <slot></slot>
  </button>
</template>

<style lang="scss">
.btn {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-16);
  min-height: var(--control-height);
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  font-family: inherit;
  font-size: var(--text-body-sm);
  line-height: var(--leading-body-sm);
  font-weight: var(--weight-medium);
  letter-spacing: normal;
  text-transform: none;
  cursor: pointer;
  transition: background-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, filter 0.2s ease;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  &__spinner {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: btn-spin 0.7s linear infinite;
  }

  &.btn-primary {
    background: var(--accent-fill);
    color: var(--text-on-accent-fill);
    box-shadow: var(--elevation-inset);

    &:hover {
      filter: brightness(1.12);
    }

    &:active {
      filter: brightness(0.96);
    }
  }

  &.btn-secondary {
    background: var(--surface-light);
    color: var(--login-text-primary);
    box-shadow: var(--elevation-inset);

    &:hover {
      background: var(--surface-hover);
      box-shadow: var(--elevation-inset-strong);
    }
  }

  &.btn-quiet {
    background: transparent;
    color: var(--login-text-secondary);
    box-shadow: var(--elevation-inset);

    &:hover {
      background: var(--surface-light);
      color: var(--login-text-primary);
    }
  }

  &.btn-danger {
    background: var(--delete-bg);
    color: var(--delete-text);
    box-shadow: inset 0 0 0 1px var(--delete-border);

    &:hover {
      background: var(--delete-bg);
      box-shadow: inset 0 0 0 1px var(--delete-text);
    }
  }

  &.btn-block {
    width: 100%;
  }

  &.btn-lg {
    padding: var(--space-12) var(--space-24);
    font-size: var(--text-body);
    min-height: var(--control-height-lg);
  }
}

@keyframes btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
