<script setup>
import Login from "@/03-widgets/Login.vue";
import Popup from "@/06-shared/components/Popup.vue";
import {ref} from "vue";
import Dropdown from "@/06-shared/components/Dropdown.vue";
import IconButton from "@/06-shared/components/IconButton.vue";
import Button from "@/06-shared/components/Button.vue";

const servers = [
  { title: "Тестовый сервер", value: "ru",},
  { title: "Тестовый сервер 2", value: "en",},
];
const currentServers = ref("Тестовый сервер");
const shownDropdown = ref(false);

const isLogin = ref(false)

</script>

<template>
    <div class="home db-page">
      <div class="d-flex home__players">
        <Dropdown
            class="home__dropdown"
            :options="servers"
            v-model="currentServers"
            :shown="shownDropdown"
            :width="'200px'"
        />
        <Button class="btn-db-green">Играть</Button>
        <IconButton tag="span" icon="settings" />
      </div>
      <div class="d-flex d-flex-colum home__servers">
        <div class="d-flex d-flex-colum home__servers-block">
          <div><span class="home-header">Аккаунт:</span> <span>1234</span></div>
          <div><span class="home-header">Онлайн:</span> <span>10</span><span>/</span><span>100</span></div>
          <div><span class="home-header">Статус сервера:</span> <span>Онлайн</span></div>
          <div><span class="home-header">Озу:</span> <span>1080</span> <span>МБ</span></div>
        </div>
        <div><Button class="btn-db-green">Перекачать конфиги</Button></div>
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
    align-items: center;
    grid-gap: 10px;
  }
  &__servers {
    grid-gap: 20px;

    &-block {
      border: 1px solid;
      border-radius: 10px;
      padding: 30px;
      grid-gap: 10px;
      align-items: flex-start;
      .home-header {
        font-weight: 600;
      }
    }
  }
}
</style>