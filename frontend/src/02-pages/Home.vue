<script setup>
import {computed, onBeforeMount, onMounted, watch, ref, onBeforeUnmount} from "vue";
import Dropdown from "@/06-shared/components/Dropdown.vue";
import IconButton from "@/06-shared/components/IconButton.vue";
import Button from "@/06-shared/components/Button.vue";
import {getStore, saveStore} from "@/06-shared/utils/presistStore.js";
import {useServerStore} from "@/05-entities/server/serverStore.js";
import {useCoreStore} from "@/05-entities/core/coreStore.js";
import { GetFileList, StartJvm} from "../../wailsjs/go/main/App.js";
import Popup from "@/06-shared/components/Popup.vue";
import Progress from "@/06-shared/components/Progress.vue";

const servers = ref([])
const currentServers = ref("Тестовый сервер");
const shownDropdown = ref(false);
const coreStore = useCoreStore()
const serverStore = useServerStore()
const nodeList = ref({})
const updateTimer = ref()

onBeforeMount(() => {
  const serversList = getStore('servers')
  if(!serversList) currentServers.value = "Нет серверов"
  else {
    currentServers.value = serversList[0].title
    servers.value = serversList
  }
  updateTimer.value = setInterval(serverStore.getServerInfo, 15000)

  window.runtime.EventsOn("totalFile", (el) => fileInfo.value.total = el)
  window.runtime.EventsOn("progress", (el) => {
    progress.value.percent = el.percent
    progress.value.read = el.read
    progress.value.total = el.total
    if(el.speed) progress.value.speed = el.speed
  })
  window.runtime.EventsOn("numberFile", (el) => {
    fileInfo.value.current = el.number
    fileName.value = el.file
  })
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
  //StartJvm()
  isLoading.value = true
  await GetFileList()
  isLoading.value = false
}

const test = async () => {
  const result = await GetFileInfo(`${coreStore.homeDir}/G.png`)
  // /home/tekina/test/updates/StargazerPrologue/imgui.ini

  alert(`${result.Name}, ${result.Size}, ${result.ModTime}, ${result.MD5Hash}`)
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
        <Button class="btn-db-green" @click="getServers">Играть</Button>
        <IconButton tag="span" icon="settings" @click="getServers" />
      </div>
      <Popup v-model:visible="isLoading">
        <div>
<!--          <img src="@/01-app/preloader/preloader.svg" alt="" width="50" />-->
          <Progress :current="fileInfo.current" :total="fileInfo.total" style="margin: auto"/>
          <p>Идет загрузка файла:</p>
          <p>{{fileName}}</p>
          <p>Загружено {{progress.percent}}% ({{progress.read}} МБ из {{progress.total}} МБ)</p>
          <p>Приемрная скорость {{progress.speed}} Mb/сек</p>
          <p>Скачано файлов:</p>
          <p>{{fileInfo.current}} / {{fileInfo.total}}</p>
        </div>
      </Popup>
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