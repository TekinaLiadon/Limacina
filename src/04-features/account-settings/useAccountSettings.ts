import { computed, ref } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { changePassword, getSessionInfo } from '@/06-shared/api'
import { reportError } from '@/06-shared'

const MIN_PASSWORD_LENGTH = 6

export function useAccountSettings() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const oldPassword = ref<string>('')
  const newPassword = ref<string>('')
  const confirmPassword = ref<string>('')
  const isChanging = ref<boolean>(false)
  const errorMessage = ref<string>('')

  const username = computed((): string => coreStore.session?.username ?? '')
  const isOffline = computed((): boolean => coreStore.projectConfig?.online === false)

  const passwordsMatch = computed((): boolean => {
    if (!confirmPassword.value) return true
    return newPassword.value === confirmPassword.value
  })

  const isSamePassword = computed((): boolean => {
    if (!oldPassword.value || !newPassword.value) return false
    return oldPassword.value === newPassword.value
  })

  const isFormValid = computed((): boolean => {
    return (
      oldPassword.value.length >= MIN_PASSWORD_LENGTH &&
      newPassword.value.length >= MIN_PASSWORD_LENGTH &&
      passwordsMatch.value &&
      !isSamePassword.value
    )
  })

  const resetForm = (): void => {
    oldPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    errorMessage.value = ''
  }

  const handleChangePassword = async (): Promise<void> => {
    if (!isFormValid.value || isChanging.value) return

    isChanging.value = true
    errorMessage.value = ''

    try {
      await changePassword(
        coreStore.currentProject,
        oldPassword.value,
        newPassword.value
      )

      const session = await getSessionInfo()
      if (session) {
        coreStore.session = session
      }

      notification.show('Пароль изменён')
      resetForm()
    } catch (e: unknown) {
      reportError('Не удалось сменить пароль', e)
      errorMessage.value = String(e)
    } finally {
      isChanging.value = false
    }
  }

  return {
    username,
    isOffline,
    oldPassword,
    newPassword,
    confirmPassword,
    passwordsMatch,
    isSamePassword,
    isFormValid,
    isChanging,
    errorMessage,
    resetForm,
    handleChangePassword,
  }
}
