import { computed, ref } from 'vue'
import { useNotificationStore, type ProjectConfig, type ServerProfileForm } from '@/05-entities'
import { createServerProfile, getErrorMessage } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { applyCreatedProfile } from './applyCreatedProfile'

export function useAddProfile() {
  const notification = useNotificationStore()

  const isSubmitting = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const serverForm = ref<ServerProfileForm>({ serverUrl: '' })

  const isServerValid = computed((): boolean => serverForm.value.serverUrl.trim().length > 0)

  const submitServer = async (): Promise<ProjectConfig | null> => {
    if (isSubmitting.value) return null
    if (!isServerValid.value) return null

    isSubmitting.value = true
    errorMessage.value = ''

    try {
      const config = await createServerProfile(serverForm.value.serverUrl.trim())
      await applyCreatedProfile(config)
      serverForm.value.serverUrl = ''
      notification.show(`Сервер «${config.projectName}» добавлен`)
      return config
    } catch (e: unknown) {
      reportError('Не удалось добавить сервер', e)
      errorMessage.value = getErrorMessage(e)
      return null
    } finally {
      isSubmitting.value = false
    }
  }

  return {
    isSubmitting,
    errorMessage,
    serverForm,
    isServerValid,
    submitServer,
  }
}
