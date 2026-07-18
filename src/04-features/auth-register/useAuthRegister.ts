import { ref, computed } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { authRegister, authLogins } from '@/06-shared/api'
import type { RegisterForm } from '@/05-entities/core/types'

export function useAuthRegister() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const isLoading = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const logins = ref<string[]>([])
  const showForm = ref<boolean>(false)

  const formData = ref<RegisterForm>({
    login: '',
    password: '',
    confirmPassword: '',
  })

  const passwordsMatch = computed((): boolean => {
    if (!formData.value.confirmPassword) return true
    return formData.value.password === formData.value.confirmPassword
  })

  const isValid = computed((): boolean => {
    return (
      formData.value.login.length > 0 &&
      formData.value.password.length > 0 &&
      formData.value.confirmPassword.length > 0 &&
      passwordsMatch.value
    )
  })

  const loadAccounts = async (): Promise<void> => {
    try {
      logins.value = await authLogins(coreStore.currentProject)
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (!isValid.value) return

    isLoading.value = true
    errorMessage.value = ''

    try {
      await authRegister(
        coreStore.currentProject,
        formData.value.login,
        formData.value.password
      )

      notification.show('Аккаунт успешно создан. Ожидайте одобрения администратора.')
      showForm.value = false
      formData.value = { login: '', password: '', confirmPassword: '' }
      await loadAccounts()
    } catch (e: unknown) {
      errorMessage.value = String(e)
    } finally {
      isLoading.value = false
    }
  }

  const openForm = (): void => {
    showForm.value = true
    errorMessage.value = ''
    formData.value = { login: '', password: '', confirmPassword: '' }
  }

  const closeForm = (): void => {
    showForm.value = false
    errorMessage.value = ''
  }

  loadAccounts()

  return {
    isLoading,
    errorMessage,
    logins,
    showForm,
    formData,
    passwordsMatch,
    isValid,
    handleSubmit,
    openForm,
    closeForm,
  }
}
