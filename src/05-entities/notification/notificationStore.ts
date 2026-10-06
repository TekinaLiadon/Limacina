import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useNotificationStore = defineStore('notification', () => {
  const message = ref<string>('')
  const visible = ref<boolean>(false)
  const timer = ref<ReturnType<typeof setTimeout> | null>(null)
  const popupMessage = ref<string>('')
  const popupVisible = ref<boolean>(false)
  const popupResolve = ref<((value: boolean) => void) | null>(null)

  function show(text: string, duration: number = 3000): void {
    hide()
    message.value = text
    visible.value = true

    timer.value = setTimeout(() => {
      timer.value = null
      visible.value = false
    }, duration)
  }

  function hide(): void {
    if (timer.value) {
      clearTimeout(timer.value)
      timer.value = null
    }
    visible.value = false
  }

  function confirm(text: string): Promise<boolean> {
    if (popupResolve.value) popupResolve.value(false)
    return new Promise((resolve) => {
      popupMessage.value = text
      popupVisible.value = true
      popupResolve.value = resolve
    })
  }

  async function runConfirmed(text: string, action: () => Promise<void> | void): Promise<void> {
    const confirmed = await confirm(text)
    if (!confirmed) return
    await action()
  }

  function resolvePopup(result: boolean): void {
    if (popupResolve.value) popupResolve.value(result)

    popupVisible.value = false
    popupMessage.value = ''
    popupResolve.value = null
  }

  return {
    message,
    visible,
    timer,
    popupMessage,
    popupVisible,
    popupResolve,
    show,
    hide,
    confirm,
    runConfirmed,
    resolvePopup,
  }
})
