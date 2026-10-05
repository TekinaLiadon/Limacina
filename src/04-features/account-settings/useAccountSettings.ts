import { computed, ref } from 'vue'
import { useCoreStore, useNotificationStore, MIN_PASSWORD_LENGTH, isPasswordConfirmed } from '@/05-entities'
import { changePassword, getErrorMessage, getSessionInfo } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useAccountSettings() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const oldPassword = ref<string>('')
  const newPassword = ref<string>('')
  const confirmPassword = ref<string>('')
  const isChanging = ref<boolean>(false)
  const errorMessage = ref<string>('')

  const username = computed((): string => coreStore.session?.username ?? '')
  const isOffline = computed((): boolean => coreStore.isOfflineProject)

  const passwordsMatch = computed((): boolean =>
    isPasswordConfirmed(newPassword.value, confirmPassword.value)
  )

  const isSamePassword = computed((): boolean => {
    if (!oldPassword.value || !newPassword.value) return false
    return oldPassword.value === newPassword.value
  })

  const isFormValid = computed((): boolean => {
    return (
      oldPassword.value.length >= MIN_PASSWORD_LENGTH &&
      newPassword.value.length >= MIN_PASSWORD_LENGTH &&
      confirmPassword.value.length > 0 &&
      passwordsMatch.value &&
      !isSamePassword.value
    )
  })

  const isSubmitDisabled = computed((): boolean => isOffline.value || !isFormValid.value)

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
    const projectName = coreStore.currentProject

    try {
      await changePassword(
        projectName,
        oldPassword.value,
        newPassword.value
      )
    } catch (e: unknown) {
      reportError('Не удалось сменить пароль', e)
      errorMessage.value = getErrorMessage(e)
      isChanging.value = false
      return
    }

    if (coreStore.currentProject !== projectName) {
      isChanging.value = false
      return
    }

    try {
      const session = await getSessionInfo()
      if (session) coreStore.applySession(session)
    } catch (e: unknown) {
      reportError('Не удалось обновить сессию после смены пароля', e)
    }

    notification.show('Пароль изменён')
    resetForm()
    isChanging.value = false
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
    isSubmitDisabled,
    isChanging,
    errorMessage,
    resetForm,
    handleChangePassword,
  }
}
