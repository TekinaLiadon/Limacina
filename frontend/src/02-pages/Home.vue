<script setup>
import Login from "@/03-widgets/Login.vue";
import Popup from "@/06-shared/components/Popup.vue";
import {ref} from "vue";

const isLogin = ref(false)
</script>

<template>
  <div class="home d-flex">
    <div class="d-flex d-flex-colum home__players">
      <ul>
        <li>1</li>
        <li>1</li>
        <li>1</li>
      </ul>
    </div>
    <div class="d-flex d-flex-colum home__servers">
      <ul>
        <li>1</li>
        <li>1</li>
        <li>1</li>
      </ul>
    </div>
  </div>
  <Popup v-model:visible="isLogin"
         maxWidth="340px">
    <Login />
  </Popup>
</template>

<style lang="scss">
.home {
  background-image: url("../assets/images/logo-universal.png");
  background-size: cover;
  margin: auto;
  height: 100%;

  &__players {
    width: 50%;
    padding: 10px;
  }
  &__servers {
    width: 50%;
    padding: 10px;
  }
}
</style>