import { computed, ref, watch } from 'vue'
import {
  useCoreStore,
  useNotificationStore,
  type ModLoaderKind,
  type OfflineProfileForm,
  type ProfileKind,
  type ProjectConfig,
  type ServerProfileForm,
} from '@/05-entities'
import {
  createOfflineProfile,
  createServerProfile,
  clearSession,
  getErrorMessage,
  getLoaderVersions,
  getMinecraftVersions,
} from '@/06-shared/api'
import { useProjectSwitch } from '@/04-features/project-switch/useProjectSwitch'
import { reportError, useAsyncRaceGuard } from '@/06-shared'
import type { DropdownOption } from '@/06-shared/types'

const LOADER_OPTIONS: DropdownOption[] = [
  { title: 'Без загрузчика (Vanilla)', value: 'vanilla' },
  { title: 'Fabric', value: 'fabric' },
  { title: 'Forge', value: 'forge' },
  { title: 'NeoForge', value: 'neoforge' },
]

export function useAddProfile() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const { resetAccountsState } = useProjectSwitch()

  const kind = ref<ProfileKind>('server')
  const isSubmitting = ref<boolean>(false)
  const errorMessage = ref<string>('')

  const serverForm = ref<ServerProfileForm>({ serverUrl: '' })

  const offlineForm = ref<OfflineProfileForm>({
    name: '',
    mcVersion: '',
    modLoader: 'vanilla',
    loaderVersion: '',
    includeSnapshots: false,
  })

  const mcVersions = ref<string[]>([])
  const loaderVersions = ref<string[]>([])
  const isLoadingMcVersions = ref<boolean>(false)
  const isLoadingLoaderVersions = ref<boolean>(false)

  const mcVersionsGuard = useAsyncRaceGuard()
  const loaderVersionsGuard = useAsyncRaceGuard()

  const loaderOptions = computed((): DropdownOption[] => LOADER_OPTIONS)

  const mcVersionOptions = computed((): DropdownOption[] =>
    mcVersions.value.map((v) => ({ title: v, value: v }))
  )

  const loaderVersionOptions = computed((): DropdownOption[] =>
    loaderVersions.value.map((v) => ({ title: v, value: v }))
  )

  const needsLoaderVersion = computed((): boolean => offlineForm.value.modLoader !== 'vanilla')

  const isServerValid = computed((): boolean => serverForm.value.serverUrl.trim().length > 0)

  const isOfflineValid = computed((): boolean => {
    if (offlineForm.value.name.trim().length === 0) return false
    if (offlineForm.value.mcVersion.length === 0) return false
    if (needsLoaderVersion.value && offlineForm.value.loaderVersion.length === 0) return false
    return true
  })

  const loadMcVersions = async (): Promise<void> => {
    const generation = mcVersionsGuard.next()

    isLoadingMcVersions.value = true
    errorMessage.value = ''

    try {
      const versions = await getMinecraftVersions(offlineForm.value.includeSnapshots)
      if (!mcVersionsGuard.isCurrent(generation)) return
      mcVersions.value = versions
      if (!mcVersions.value.includes(offlineForm.value.mcVersion)) {
        offlineForm.value.mcVersion = mcVersions.value[0] ?? ''
      }
    } catch (e: unknown) {
      if (!mcVersionsGuard.isCurrent(generation)) return
      errorMessage.value = getErrorMessage(e)
      mcVersions.value = []
    } finally {
      if (mcVersionsGuard.isCurrent(generation)) isLoadingMcVersions.value = false
    }
  }

  const loadLoaderVersions = async (): Promise<void> => {
    if (!needsLoaderVersion.value || !offlineForm.value.mcVersion) {
      loaderVersions.value = []
      offlineForm.value.loaderVersion = ''
      return
    }

    const generation = loaderVersionsGuard.next()

    isLoadingLoaderVersions.value = true
    errorMessage.value = ''

    try {
      const versions = await getLoaderVersions(
        offlineForm.value.modLoader,
        offlineForm.value.mcVersion
      )
      if (!loaderVersionsGuard.isCurrent(generation)) return
      loaderVersions.value = versions
      offlineForm.value.loaderVersion = loaderVersions.value[0] ?? ''
      if (loaderVersions.value.length === 0) {
        errorMessage.value = `Нет версий ${offlineForm.value.modLoader} для Minecraft ${offlineForm.value.mcVersion}`
      }
    } catch (e: unknown) {
      if (!loaderVersionsGuard.isCurrent(generation)) return
      errorMessage.value = getErrorMessage(e)
      loaderVersions.value = []
      offlineForm.value.loaderVersion = ''
    } finally {
      if (loaderVersionsGuard.isCurrent(generation)) isLoadingLoaderVersions.value = false
    }
  }

  const applyCreatedProfile = async (config: ProjectConfig): Promise<void> => {
    if (!coreStore.projects.includes(config.projectName)) {
      coreStore.projects = [...coreStore.projects, config.projectName]
    }
    if (coreStore.launcherConfig) {
      coreStore.launcherConfig.projectNames = [...coreStore.projects]
      coreStore.launcherConfig.currentProject = config.projectName
    }
    coreStore.currentProject = config.projectName
    coreStore.projectConfig = config
    resetAccountsState()

    try {
      await clearSession()
    } catch (e: unknown) {
      reportError('Не удалось выйти из аккаунта', e)
    }
  }

  const selectKind = async (value: ProfileKind): Promise<void> => {
    kind.value = value
    errorMessage.value = ''

    if (value === 'offline' && mcVersions.value.length === 0) {
      await loadMcVersions()
    }
  }

  const submitServer = async (): Promise<ProjectConfig | null> => {
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
      errorMessage.value = getErrorMessage(e)
      return null
    } finally {
      isSubmitting.value = false
    }
  }

  const submitOffline = async (): Promise<ProjectConfig | null> => {
    if (!isOfflineValid.value) return null

    isSubmitting.value = true
    errorMessage.value = ''

    try {
      const config = await createOfflineProfile(
        offlineForm.value.name.trim(),
        offlineForm.value.mcVersion,
        offlineForm.value.modLoader,
        needsLoaderVersion.value ? offlineForm.value.loaderVersion : null
      )
      await applyCreatedProfile(config)
      offlineForm.value.name = ''
      notification.show(`Профиль «${config.projectName}» создан`)
      return config
    } catch (e: unknown) {
      errorMessage.value = getErrorMessage(e)
      return null
    } finally {
      isSubmitting.value = false
    }
  }

  watch(() => offlineForm.value.includeSnapshots, loadMcVersions)
  watch(
    [(): ModLoaderKind => offlineForm.value.modLoader, (): string => offlineForm.value.mcVersion],
    loadLoaderVersions
  )

  return {
    kind,
    isSubmitting,
    errorMessage,
    serverForm,
    offlineForm,
    mcVersionOptions,
    loaderOptions,
    loaderVersionOptions,
    needsLoaderVersion,
    isLoadingMcVersions,
    isLoadingLoaderVersions,
    isServerValid,
    isOfflineValid,
    selectKind,
    submitServer,
  submitOffline,
  }
}
