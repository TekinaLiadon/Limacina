<script setup>
import DashboardWrapper from "@/03-widgets/dashboard/DashboardWrapper.vue";
</script>

<template>
  <main class="app">
    <DashboardWrapper>
      <router-view />
      <slot />
    </DashboardWrapper>
  </main>
</template>

<style lang="scss">
@use "@/01-app/assets/main.scss";
.app {
  height: 100%;
}
</style>
