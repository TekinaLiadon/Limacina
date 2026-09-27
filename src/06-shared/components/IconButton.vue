<script setup lang="ts">
import Icon from '@/06-shared/components/Icon.vue'
import type { IconType } from '@/06-shared/types'

const props = withDefaults(defineProps<{
  icon: IconType
  tag?: string
}>(), {
  tag: 'button',
})
</script>

<template>
  <component :is="props.tag" class="icon-btn">
    <Icon :type="icon" class="icon-btn__icon" />
  </component>
</template>

<style lang="scss">
@use "@/01-app/assets/breakpoints";

.icon-btn {
  cursor: pointer;
  width: var(--control-height);
  height: var(--control-height);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-circle);
  background-color: var(--surface-light);
  box-shadow: var(--elevation-inset);
  border: none;
  transition: background-color var(--duration-base) var(--ease-out), box-shadow var(--duration-base) var(--ease-out), transform var(--duration-fast) var(--ease-out);

  &:active {
    transform: scale(0.94);
  }

  &__icon {
    font-size: var(--icon-size);
    width: var(--icon-size);
    height: var(--icon-size);
    color: var(--login-text-secondary);
    transition: color var(--duration-base) var(--ease-out);
  }

  @include breakpoints.media-under-sm {
    width: var(--control-height-sm);
    height: var(--control-height-sm);
  }
}

.icon-btn:hover {
  background-color: var(--surface-hover);
  box-shadow: var(--elevation-inset-strong);
}
</style>
