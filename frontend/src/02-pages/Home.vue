<script setup>
import {computed, onBeforeMount, onMounted, watch, ref, onBeforeUnmount} from "vue";
import Dropdown from "@/06-shared/components/Dropdown.vue";
import IconButton from "@/06-shared/components/IconButton.vue";
import Button from "@/06-shared/components/Button.vue";
import {getStore, saveStore} from "@/06-shared/utils/presistStore.js";
import {useServerStore} from "@/05-entities/server/serverStore.js";

const servers = ref([])
const currentServers = ref("Тестовый сервер");
const shownDropdown = ref(false);
const serverStore = useServerStore()
const nodeList = ref({})
const updateTimer = ref()

onBeforeMount(() => {
  const serversList = getStore('servers')
  serverStore.getServerInfo()
  if(!serversList) currentServers.value = "Нет серверов"
  else {
    currentServers.value = serversList[0].title
    servers.value = serversList
  }
  updateTimer.value = setInterval(serverStore.getServerInfo, 15000)
})
onMounted(() => {
  document.querySelectorAll(`[data-stats]`).forEach((el) => {
    const keys = Object.entries(el.dataset)[0]
    if(!nodeList.value[keys[0]]) nodeList.value[keys[0]] = {}
    nodeList.value[keys[0]][keys[1]] = el
  })
})

const online = computed(() => {
  return serverStore.serverInfo?.online ? 'Онлайн' : "Выключен"
})
function animateValue(obj, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (end - start) + start);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

watch(() => serverStore.serverInfo, (newV, oldV) => {
  animateValue(nodeList.value.stats.min, oldV.players?.online ||0, newV.players.online, 1000)
  //if(!oldV.players?.online) return
  animateValue(nodeList.value.stats.max, oldV.players?.max ||0, newV.players.max, !oldV.players?.online ? 1 : 1000)
})

const getServers = () => {
  saveStore([
    { title: "Тестовый сервер", value: "ru",},
    { title: "Тестовый сервер 2", value: "en",},
  ], 'servers')
}


onBeforeUnmount(() => {
  clearInterval(updateTimer.value)
})
</script>

<template>
    <div class="home db-page">
      <div class="d-flex d-flex-colum home__servers">
        <div class="d-flex d-flex-colum home__servers-block">
<!--          <div><span class="home-header">Аккаунт:</span> <span>1234</span></div>-->
          <div><span class="home-header">Онлайн:</span> <span data-stats="min">0</span><span>/</span><span data-stats="max">10</span></div>
          <div><span class="home-header">Статус сервера:</span> <span>{{online}}</span></div>
          <div><span class="home-header">Озу:</span> <span>1080</span> <span>МБ</span></div>
        </div>
<!--        <div><Button class="btn-db-green">Перекачать конфиги</Button></div>-->
      </div>
      <div class="d-flex home__players">
        <Dropdown
            class="home__dropdown"
            :options="servers"
            v-model="currentServers"
            :shown="shownDropdown"
            :width="'200px'"
        />
        <Button class="btn-db-green">Играть</Button>
        <IconButton tag="span" icon="settings" @click="getServers" />
      </div>
    </div>
</template>

<style lang="scss">
.home {
  margin: auto;
  height: 100%;
  flex-direction: column;
  align-items: center;

  &__players {
    width: 60%;
    padding: 10px;
    align-items: center;
    grid-gap: 10px;
  }
  &__servers {
    width: 60%;
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