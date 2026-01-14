<template>
  <div class="preloader">
    <img src="./preloader.svg" alt="" />
  </div>
</template>

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
  background: #fff;
  display: flex;
  justify-content: center;
  align-items: center;

  img {
    max-width: 150px;
    width: 100%;
    height: auto;
    margin: auto;
  }
}
</style>
