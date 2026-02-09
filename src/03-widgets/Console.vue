<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';

const logs = ref([]);

const consoleRef = ref(null);

let unlisten = null;

onMounted(async () => {
  unlisten = await listen('game-console', (event) => {
    logs.value.push(event.payload);

    if (logs.value.length > 2000) {
      logs.value.shift();
    }
  });
});

onUnmounted(() => {
  if (unlisten) {
    unlisten();
  }
});

watch(logs, async () => {
  await nextTick();
  if (consoleRef.value) {
    consoleRef.value.scrollTop = consoleRef.value.scrollHeight;
  }
}, { deep: true });
</script>

<template>
  <div class="console-container" ref="consoleRef">
    <div v-for="(log, index) in logs" :key="index" class="log-line">
      <span :class="{ 'text-error': log.is_error, 'text-normal': !log.is_error }">
        {{ log.line }}
      </span>
    </div>
  </div>
</template>

<style>
.console-container {
  background-color: #1e1e1e;
  color: #e0e0e0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  height: 90vh;
  width: 50%;
  overflow-y: auto;
  padding: 10px;
  margin: 25px;
  box-sizing: border-box;
  word-wrap: break-word;
  display: flex;
  flex-wrap: wrap;
}

.log-line {
  line-height: 1.4;
  margin-bottom: 2px;
}

.text-normal {
  color: #cccccc;
}

.text-error {
  color: #ff5555;
}
</style>