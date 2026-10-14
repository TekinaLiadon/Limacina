import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ServerStatus } from '../core/types'

export const useServerStore = defineStore('server', () => {
  const serverStatus = ref<ServerStatus | null>(null)
  const isServerReachable = ref<boolean | null>(null)

  function setServerStatus(status: ServerStatus | null): void {
    serverStatus.value = status
  }

  function setReachable(reachable: boolean | null): void {
    isServerReachable.value = reachable
  }

  function resetServerState(): void {
    serverStatus.value = null
    isServerReachable.value = null
  }

  return { serverStatus, isServerReachable, setServerStatus, setReachable, resetServerState }
})
