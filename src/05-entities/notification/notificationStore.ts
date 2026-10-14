import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useNotificationStore = defineStore('notification', () => {
  const message = ref<string>('')
  const visible = ref<boolean>(false)
  const popupMessage = ref<string>('')
  const popupVisible = ref<boolean>(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let popupResolve: ((value: boolean) => void) | null = null

  function show(text: string, duration: number = 3000): void {
    hide()
    message.value = text
    visible.value = true

    timer = setTimeout(() => {
      timer = null
      visible.value = false
    }, duration)
  }

  function hide(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    visible.value = false
  }

  function confirm(text: string): Promise<boolean> {
    if (popupResolve !== null) popupResolve(false)
    return new Promise((resolve) => {
      popupMessage.value = text
      popupVisible.value = true
      popupResolve = resolve
    })
  }

  async function runConfirmed(text: string, action: () => Promise<void> | void): Promise<void> {
    const confirmed = await confirm(text)
    if (!confirmed) return
    await action()
  }

  function resolvePopup(result: boolean): void {
    if (popupResolve !== null) popupResolve(result)

    popupVisible.value = false
    popupMessage.value = ''
    popupResolve = null
  }

  return {
    message,
    visible,
    popupMessage,
    popupVisible,
    show,
    hide,
    confirm,
    runConfirmed,
    resolvePopup,
  }
})
