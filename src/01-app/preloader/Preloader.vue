<template>
  <div class="preloader">
    <img src="./preloader.svg" alt="" />
    <div v-if="text" class="preloader__text">{{ text }}</div>
  </div>
</template>

<script setup>
defineProps({
  text: {
    type: String,
    default: "",
  },
});
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
    margin-top: 20px;
    font-size: 16px;
    color: var(--login-text-primary);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
}
</style>
