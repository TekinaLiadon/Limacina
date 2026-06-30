<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

const logs = ref([]);

const consoleRef = ref(null);

let unlisten = null;

onMounted(async () => {
  const startupLogs = await invoke('get_startup_logs');
  for (const log of startupLogs) {
    logs.value.push(log);
  }

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
      <span :class="log.is_error ? 'text-error' : 'text-normal'">
        {{ log.line }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.console-container {
  background-color: #1e1e1e;
  color: #e0e0e0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  height: 90vh;
  width: 50%;
  overflow-y: auto;
  padding: 10px;
  margin: 25px;
  box-sizing: border-box;
  display: block;
  text-align: left;
}

.log-line {
  line-height: 1.4;
  margin-bottom: 2px;
  width: 100%;
  display: block;
  text-align: left;
  word-break: break-all;
  white-space: pre-wrap;
}

.text-normal {
  color: #cccccc;
}

.text-error {
  color: #ff5555;
  font-weight: bold;
}
</style>