<template>
  <div class="preloader" :class="{ 'preloader--local': props.local }">
    <img src="./preloader.svg" alt="" />
    <div class="preloader__text">{{ props.text }}</div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  text?: string
  local?: boolean
}>(), {
  text: 'Получение данных',
  local: false,
})
</script>

<style lang="scss" scoped>
@use '@/01-app/assets/mixins';

.preloader {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: var(--z-preloader);
  background: var(--app-bg);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  img {
    max-width: 150px;
    width: 100%;
    height: auto;
  }

  &--local {
    position: absolute;
    background: var(--login-bg-form);
  }

  &__text {
    @include mixins.eyebrow($line-height: null);

    margin-top: var(--space-20);
    font-family: var(--font-eyebrow);
  }
}
</style>
