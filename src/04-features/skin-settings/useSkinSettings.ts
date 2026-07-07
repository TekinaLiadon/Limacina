import { ref } from 'vue'

export function useSkinSettings() {
  const skinUrl = ref<string>('')
  const errorMessage = ref<string>('')

  const selectSkin = async (): Promise<void> => {
    errorMessage.value = ''

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.png,image/png'

    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) return

      if (!file.name.toLowerCase().endsWith('.png')) {
        errorMessage.value = 'Допустимый формат — только .png'
        return
      }

      if (file.size > 256 * 1024) {
        errorMessage.value = 'Размер файла не должен превышать 256 КB'
        return
      }

      const reader = new FileReader()
      reader.onload = (): void => {
        const dataUrl = reader.result as string

        const img = new Image()
        img.onload = () => {
          skinUrl.value = dataUrl
        }
        img.onerror = () => {
          errorMessage.value = 'Не удалось загрузить изображение'
        }
        img.src = dataUrl
      }
      reader.onerror = () => {
        errorMessage.value = 'Не удалось прочитать файл'
      }
      reader.readAsDataURL(file)
    }

    input.click()
  }

  const resetSkin = (): void => {
    skinUrl.value = ''
    errorMessage.value = ''
  }

  return {
    skinUrl,
    errorMessage,
    selectSkin,
    resetSkin,
  }
}
