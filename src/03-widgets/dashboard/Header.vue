<script setup>
import HeaderMenu from "@/03-widgets/dashboard/HeaderMenu.vue";
</script>

<template>
  <header class="header">
    <div class="header__logo">

    </div>
    <HeaderMenu />
  </header>
</template>

<style lang="scss">
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 15px;

  &__logo {
    img {
      width: 60px;
      height: 52px;
    }
  }
}
</style>
