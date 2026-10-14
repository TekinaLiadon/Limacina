import { computed, ref, watch, type Ref } from 'vue'
import {
  useNotificationStore,
  LOADER_LABELS,
  type ModLoaderKind,
  type OfflineProfileForm,
  type ProfileKind,
  type ProjectConfig,
} from '@/05-entities'
import {
  createOfflineProfile,
  getErrorMessage,
  getLoaderVersions,
  getMinecraftVersions,
} from '@/06-shared/api'
import { reportError, useAsyncRaceGuard, type DropdownOption } from '@/06-shared'
import { applyCreatedProfile } from './applyCreatedProfile'

const loaderOption = (value: ModLoaderKind): DropdownOption => ({
  value,
  title: value === 'vanilla' ? 'Без загрузчика (Vanilla)' : LOADER_LABELS[value],
})

const LOADER_OPTIONS: DropdownOption[] = (Object.keys(LOADER_LABELS) as ModLoaderKind[]).map(
  loaderOption,
)

export interface OfflineProfileFormContext {
  isSubmitting: Ref<boolean>
  errorMessage: Ref<string>
}

export function useOfflineProfileForm({ isSubmitting, errorMessage }: OfflineProfileFormContext) {
  const notification = useNotificationStore()

  const kind = ref<ProfileKind>('server')

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
      reportError('Не удалось загрузить версии Minecraft', e)
      errorMessage.value = getErrorMessage(e)
      mcVersions.value = []
    } finally {
      if (mcVersionsGuard.isCurrent(generation)) isLoadingMcVersions.value = false
    }
  }

  const loadLoaderVersions = async (): Promise<void> => {
    if (!needsLoaderVersion.value || !offlineForm.value.mcVersion) {
      loaderVersionsGuard.cancel()
      isLoadingLoaderVersions.value = false
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
      reportError('Не удалось загрузить версии загрузчика', e)
      errorMessage.value = getErrorMessage(e)
      loaderVersions.value = []
      offlineForm.value.loaderVersion = ''
    } finally {
      if (loaderVersionsGuard.isCurrent(generation)) isLoadingLoaderVersions.value = false
    }
  }

  const selectKind = async (value: ProfileKind): Promise<void> => {
    kind.value = value
    errorMessage.value = ''

    if (value === 'offline' && mcVersions.value.length === 0) {
      await loadMcVersions()
    }
  }

  const submitOffline = async (): Promise<ProjectConfig | null> => {
    if (isSubmitting.value) return null
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
      notification.show(`Профиль "${config.projectName}" создан`)
      return config
    } catch (e: unknown) {
      reportError('Не удалось создать профиль', e)
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
    offlineForm,
    mcVersionOptions,
    loaderOptions,
    loaderVersionOptions,
    needsLoaderVersion,
    isLoadingMcVersions,
    isLoadingLoaderVersions,
    isOfflineValid,
    selectKind,
    submitOffline,
  }
}
