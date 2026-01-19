<script setup>
import {computed, onBeforeMount, onMounted, watch, ref, onBeforeUnmount} from "vue";
import Dropdown from "@/06-shared/components/Dropdown.vue";
import IconButton from "@/06-shared/components/IconButton.vue";
import Button from "@/06-shared/components/Button.vue";
import {getStore, saveStore} from "@/06-shared/utils/presistStore.js";
import {useServerStore} from "@/05-entities/server/serverStore.js";
import {useCoreStore} from "@/05-entities/core/coreStore.js";
import Progress from "@/06-shared/components/Progress.vue";
import { invoke } from '@tauri-apps/api/core';

const servers = computed({
  get() {
    if(serverStore.serversList) return  serverStoreserversList.map((el) => {
      var result = {
        title: el.name,
        value: el.name
      }
      return result
    })
    else return []
  },
  set(newValue){
    serverStore.$patch((state) => {
      state.serverName = newValue.value;
    })
  }
})
const currentServers = computed( {
  get() {
    return serverStore.serverName || '';
  },
  set(newValue) {
    serverStore.$patch((state) => {
      state.serverName = newValue;
    });
  },
});
const shownDropdown = ref(false);
const coreStore = useCoreStore()
const serverStore = useServerStore()
const nodeList = ref({})
const updateTimer = ref()

onBeforeMount(() => {
  const serversList = getStore('servers')
  if(serversList)  {
    serverStore.$patch((state) => {
      state.serverList = [...state, ...serversList]
    })
  }
  updateTimer.value = setInterval(() => serverStore.getServerInfo(serversList.currentServer.urlStatus), 15000)

})
onMounted(() => {
  document.querySelectorAll(`[data-stats]`).forEach((el) => {
    const keys = Object.entries(el.dataset)[0]
    if(!nodeList.value[keys[0]]) nodeList.value[keys[0]] = {}
    nodeList.value[keys[0]][keys[1]] = el
  })
  // TODO Перенести
  animateValue(nodeList.value.stats.min, 0, serverStore.serverInfo.players.online, 1000)
  animateValue(nodeList.value.stats.max, 0, serverStore.serverInfo.players.max, 1 )

  //
  /*const BigInt = window.BigInt,
      bigThirtyTwo = BigInt(32),
      bigZero = BigInt(0);
  function getUint64(dataview, byteOffset, littleEndian = false) {
    const left = BigInt(dataview.getUint32(byteOffset | 0, !!littleEndian) >>> 0);
    const right = BigInt(
        dataview.getUint32(((byteOffset | 0) + 4) | 0, !!littleEndian) >>> 0,
    );
    return littleEndian
        ? (right << bigThirtyTwo) | left
        : (left << bigThirtyTwo) | right;
  }

  function generateUUIDFromUsername(username) {
    const bytes = new TextEncoder().encode(username);

    const buffer = new Uint8Array(16);
    buffer.set(bytes);
    buffer.fill(0, bytes.length);
    const mostSignificantBits = getUint64(new DataView(buffer.buffer), 0)
    const leastSignificantBits = getUint64(new DataView(buffer.buffer), 8)

    const uuid = crypto.randomUUID(mostSignificantBits, leastSignificantBits);

    return uuid.toString();
  }
  console.log(generateUUIDFromUsername('Break'))*/
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

const fileInfo = ref({
  total: 0,
  current: 0,
})
const fileName = ref('')
const progress = ref({
  percent: 0,
  read: 0,
  total: 0,
  speed: 0,
})
const isLoading = ref(false)

const getServers = async () => {
  /*DownloadFabric("1.20.1")
  return
  DownloadMinecraftVersion("1.20.1")
  return*/
  /*const result = await invoke('download_minecraft_version', {
    version: "1.20.1"
  }); */
  const result = await invoke('get_fabric', {
    mcVersion: "1.20.1"
  });
  const result2 = await invoke('download_minecraft_version', {
    version: "1.20.1"
  });
  const result3 = await invoke('start_jvm', {
    username: "Break",
    uuid: "cabb620d78524907963fb7c0aaa97dc6",
    accessToken: "5730aacc7d65c752b53ca07500e24735",
    typeMinecraft: "fabric"
  });
  isLoading.value = !isLoading.value
  fileName.value = result
}

const test = async () => {
  // /home/tekina/test/updates/StargazerPrologue/imgui.ini
}

const updateConfig = () =>{
  getServers()
}

onBeforeUnmount(() => {
  clearInterval(updateTimer.value)
})
</script>

<template>
  <div style="width: 100%">
    <div class="home db-page" v-if="!isLoading">
      <div class="d-flex d-flex-colum home__servers">
        <div class="d-flex d-flex-colum home__servers-block">
<!--          <div><span class="home-header">Аккаунт:</span> <span>1234</span></div>-->
          <div><span class="home-header">Онлайн:</span> <span data-stats="min">0</span><span>/</span><span data-stats="max">10</span></div>
          <div><span class="home-header">Статус сервера:</span> <span>{{online}}</span></div>
          <div><span class="home-header">Озу:</span> <span>1080</span> <span>МБ</span></div>
        </div>
     <div><Button class="btn-db-green" @click="updateConfig">Перекачать конфиги</Button></div>
      </div>
      <div class="d-flex home__players">
        <Dropdown
            v-if="servers.length > 1"
            class="home__dropdown"
            :options="servers"
            v-model="currentServers"
            :shown="shownDropdown"
            :width="'200px'"
        />
        <div class="home__players-solo-server" v-else>{{currentServers}}</div>
        <Button class="btn-db-green" @click="getServers">Играть</Button>
        <IconButton tag="span" icon="settings" @click="getServers" />
      </div>
    </div>
  <div class="home db-page" v-else>
    <Progress :current="fileInfo.current" :total="fileInfo.total" style="margin: auto"/>
    <p>Идет загрузка файла:</p>
    <p>{{fileName}}</p>
    <p>Загружено {{progress.percent}}% ({{progress.read}} МБ из {{progress.total}} МБ)</p>
    <p>Примерная скорость {{progress.speed}} Mb/сек</p>
    <p>Скачано файлов:</p>
    <p>{{fileInfo.current}} / {{fileInfo.total}}</p>
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

    &-solo-server {
      padding: 10px;
      border-radius: 12px;
      border: 1px solid black;
      cursor: default;
      width: 200px;
    }
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