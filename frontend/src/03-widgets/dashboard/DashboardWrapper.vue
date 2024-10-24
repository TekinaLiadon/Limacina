<script setup>
import Header from "@/03-widgets/dashboard/Header.vue";
import Sidebar from "@/03-widgets/dashboard/Sidebar.vue";

</script>

<template>
  <div class="dashboard-wrapper">
    <div class="dashboard-wrapper__container">
      <Header />
      <div class="dashboard-wrapper__content">
<!--        <Sidebar class="dashboard-wrapper__sidebar" />-->
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use "@/01-app/assets/breakpoints";

.dashboard-wrapper {
  background-color: rgba(246, 245, 249, 1);
  font-family: "RisingSun", sans-serif;

  &__container {
    min-width: 1400px;
    max-width: 85%;
    margin: 0 auto;
    padding: 35px 20px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  &__content {
    flex: 1 1 auto;
    display: flex;
    gap: 60px;
  }

  @include breakpoints.media-under-xxl {
    &__container {
      min-width: unset;
      max-width: 100%;
    }

    &__content {
      gap: 30px;
    }
  }

  @include breakpoints.media-under-lg{
    &__content {
      flex-direction: column-reverse;
      gap: 18px;
    }
  }
}
</style>
