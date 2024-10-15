<script setup></script>

<template>
  <main class="app">
    <router-view />
    <slot />
  </main>
</template>

<style lang="scss">
@use "@/01-app/assets/main.scss";
.app {
  height: 100%;
}
</style>
