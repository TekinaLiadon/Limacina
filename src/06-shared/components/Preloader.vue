<template>
  <div class="preloader">
    <img src="./preloader.svg" alt="" />
    <div class="preloader__text">{{ props.text }}</div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  text?: string
}>(), {
  text: 'Получение данных',
})
</script>

<style lang="scss" scoped>
.preloader {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1111;
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

  &__text {
    margin-top: var(--space-20);
    font-family: var(--font-eyebrow);
    font-size: var(--text-caption);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-eyebrow);
    text-transform: uppercase;
    color: var(--login-text-muted);
  }
}
</style>
