import { defineStore } from 'pinia'

interface NotificationState {
  message: string
  visible: boolean
  timer: ReturnType<typeof setTimeout> | null
  popupMessage: string
  popupVisible: boolean
  popupResolve: ((value: boolean) => void) | null
}

export const useNotificationStore = defineStore('notification', {
  state: (): NotificationState => ({
    message: '',
    visible: false,
    timer: null,
    popupMessage: '',
    popupVisible: false,
    popupResolve: null,
  }),

  actions: {
    show(message: string, duration: number = 3000): void {
      this.hide()
      this.message = message
      this.visible = true

      this.timer = setTimeout(() => {
        this.visible = false
      }, duration)
    },

    hide(): void {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
      this.visible = false
    },

    confirm(message: string): Promise<boolean> {
      return new Promise((resolve) => {
        this.popupMessage = message
        this.popupVisible = true
        this.popupResolve = resolve
      })
    },

    resolvePopup(result: boolean): void {
      if (this.popupResolve) this.popupResolve(result)

      this.popupVisible = false
      this.popupMessage = ''
      this.popupResolve = null
    },
  },
})
