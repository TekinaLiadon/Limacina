<script setup>


</script>

<template>
  <div class="header-menu">

  </div>
</template>

<style lang="scss">
.header-menu {
  width: 60px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 5px 10px;
  border-radius: 60px;
  background-color: var(--white);
  position: relative;
  transition: all 0.2s linear;

  &-active {
    width: 80px;
    transition: width 0.2s linear;
  }

  &.dropdown-shown {
    border-radius: 30px 30px 0 0;
  }

  &__country {
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(236, 235, 241, 1);

    img {
      width: 20px;
      height: 20px;
    }
  }

  &__user {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid rgba(105, 107, 115, 1);
    display: flex;
    align-items: center;
    justify-content: center;

    .icon {
      font-size: 20px;
    }
  }

  &__user-avatar {
    width: 100%;
    height: 100%;
  }

  &__dropdown.dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background-color: var(--white);
  }
}

.header-dropdown {
  &-enter-active,
  &-leave-active {
    transition: all 0.2s ease;
  }

  &-enter-from,
  &-leave-to {
    opacity: 0;
    transform: translateY(-10px);
  }

  &-enter-to,
  &-leave-from {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
