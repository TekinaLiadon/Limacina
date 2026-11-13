import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { FiguraAvatarEntry } from '../core/types'

export const useFiguraStore = defineStore('figura', () => {
  const list = ref<FiguraAvatarEntry[] | null>(null)
  const selectedName = ref<string | null>(null)
  const isListLoading = ref<boolean>(false)
  const listError = ref<string>('')

  function setList(entries: FiguraAvatarEntry[]): void {
    list.value = [...entries]
  }

  function select(name: string | null): void {
    selectedName.value = name
  }

  function reset(): void {
    list.value = null
    selectedName.value = null
    isListLoading.value = false
    listError.value = ''
  }

  return {
    list,
    selectedName,
    isListLoading,
    listError,
    setList,
    select,
    reset,
  }
})
