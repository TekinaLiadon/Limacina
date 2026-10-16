import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { GameOptions } from '../core/types'

interface PendingGameOptions {
  project: string
  options: GameOptions
}

export const useGameOptionsStore = defineStore('gameOptions', () => {
  const pending = ref<PendingGameOptions | null>(null)

  function setPending(project: string, options: GameOptions): void {
    pending.value = {
      project,
      options: { ...options, resourcePacks: [...options.resourcePacks] },
    }
  }

  function pendingFor(project: string): GameOptions | null {
    if (pending.value?.project !== project) return null
    return pending.value.options
  }

  function clearPending(project: string): void {
    if (pending.value?.project !== project) return
    pending.value = null
  }

  return { setPending, pendingFor, clearPending }
})
