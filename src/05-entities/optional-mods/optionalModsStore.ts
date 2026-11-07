import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { OptionalModEntry } from '../core/types'

export const useOptionalModsStore = defineStore('optionalMods', () => {
  const list = ref<OptionalModEntry[] | null>(null)

  function setList(entries: OptionalModEntry[]): void {
    list.value = [...entries]
  }

  function reset(): void {
    list.value = null
  }

  return {
    list,
    setList,
    reset,
  }
})
