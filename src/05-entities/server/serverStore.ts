import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ServerStatus } from '../core/types'

export const useServerStore = defineStore('server', () => {
  const serverStatus = ref<ServerStatus | null>(null)
  const isServerReachable = ref<boolean | null>(null)

  return { serverStatus, isServerReachable }
})
