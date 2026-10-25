import { computed, ref } from 'vue'
import { useNotificationStore, type ProjectConfig, type ServerProfileForm } from '@/05-entities'
import { createServerProfile } from '@/06-shared/api'
import { runScopedAction } from '@/06-shared'
import { applyCreatedProfile } from './applyCreatedProfile'
import { isProfileCreationBlocked } from './isProfileCreationBlocked'

export function useAddProfile() {
  const notification = useNotificationStore()

  const isSubmitting = ref<boolean>(false)
  const errorMessage = ref<string>('')
  const serverForm = ref<ServerProfileForm>({ serverUrl: '' })

  const isServerValid = computed((): boolean => serverForm.value.serverUrl.trim().length > 0)

  const submitServer = async (): Promise<ProjectConfig | null> => {
    if (isSubmitting.value) return null
    if (!isServerValid.value) return null
    if (isProfileCreationBlocked()) return null

    const created = await runScopedAction({
      busyFlag: isSubmitting,
      errorTarget: errorMessage,
      errorMessage: 'Не удалось добавить сервер',
      run: (): Promise<ProjectConfig> => createServerProfile(serverForm.value.serverUrl.trim()),
      apply: async (config: ProjectConfig): Promise<ProjectConfig> => {
        await applyCreatedProfile(config)
        serverForm.value.serverUrl = ''
        notification.show(`Сервер "${config.projectName}" добавлен`)
        return config
      },
    })
    return created ?? null
  }

  return {
    isSubmitting,
    errorMessage,
    serverForm,
    isServerValid,
    submitServer,
  }
}
