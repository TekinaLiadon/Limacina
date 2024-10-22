<script setup>
import Login from "@/03-widgets/Login.vue";
import Popup from "@/06-shared/components/Popup.vue";
import {ref} from "vue";
import Dropdown from "@/06-shared/components/Dropdown.vue";
const langs = [
  { title: "RU", value: "ru",},
  { title: "EN", value: "en",},
];
const currentLang = ref("ru");
const shownDropdown = ref(false);

const isLogin = ref(false)

</script>

<template>
    <div class="home db-page">
      <div class="d-flex d-flex-colum home__players">
        <Dropdown
            class="home__dropdown"
            :options="langs"
            v-model="currentLang"
            :shown="shownDropdown"
        />
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