<script setup lang="ts">
import Icon from '@/06-shared/components/Icon.vue'

const props = withDefaults(defineProps<{
  icon: string
  tag?: string
  up?: boolean
  down?: boolean
}>(), {
  tag: 'button',
  up: false,
  down: false,
})
</script>

<template>
  <component :is="props.tag" class="icon-btn">
    <Icon
      :type="icon"
      class="icon-btn__icon"
      :up="props.up"
      :down="props.down"
    />
  </component>
</template>

<style lang="scss">
@use "@/01-app/assets/breakpoints";

.icon-btn {
  cursor: pointer;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-circle);
  background-color: var(--surface-light);
  box-shadow: var(--elevation-inset);
  border: none;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;

  &__icon {
    font-size: 18px;
    width: 18px;
    height: 18px;
    color: var(--login-text-secondary);
    transition: color 0.2s ease;
  }

  @include breakpoints.media-under-sm {
    width: 36px;
    height: 36px;
  }
}

.active .icon-btn,
.icon-btn:hover {
  background-color: var(--surface-hover);
  box-shadow: var(--elevation-inset-strong);
}
</style>
