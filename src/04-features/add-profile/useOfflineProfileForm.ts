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
  getLoaderVersions,
  getMinecraftVersions,
} from '@/06-shared/api'
import { runScopedAction, useAsyncRaceGuard, type DropdownOption } from '@/06-shared'
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
  const mcVersionsError = ref<string>('')
  const loaderVersionsError = ref<string>('')
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
    await runScopedAction({
      guard: mcVersionsGuard,
      busyFlag: isLoadingMcVersions,
      errorTarget: mcVersionsError,
      errorMessage: 'Не удалось загрузить версии Minecraft',
      run: (): Promise<string[]> => getMinecraftVersions(offlineForm.value.includeSnapshots),
      onError: (): void => {
        mcVersions.value = []
      },
      apply: (versions: string[]): void => {
        mcVersions.value = versions
        if (!mcVersions.value.includes(offlineForm.value.mcVersion)) {
          offlineForm.value.mcVersion = mcVersions.value[0] ?? ''
        }
      },
    })
  }

  const loadLoaderVersions = async (): Promise<void> => {
    if (!needsLoaderVersion.value || !offlineForm.value.mcVersion) {
      loaderVersionsGuard.cancel()
      isLoadingLoaderVersions.value = false
      loaderVersions.value = []
      loaderVersionsError.value = ''
      offlineForm.value.loaderVersion = ''
      return
    }

    await runScopedAction({
      guard: loaderVersionsGuard,
      busyFlag: isLoadingLoaderVersions,
      errorTarget: loaderVersionsError,
      errorMessage: 'Не удалось загрузить версии загрузчика',
      run: (): Promise<string[]> => getLoaderVersions(
        offlineForm.value.modLoader,
        offlineForm.value.mcVersion,
      ),
      onError: (): void => {
        loaderVersions.value = []
        offlineForm.value.loaderVersion = ''
      },
      apply: (versions: string[]): void => {
        loaderVersions.value = versions
        offlineForm.value.loaderVersion = loaderVersions.value[0] ?? ''
        if (loaderVersions.value.length === 0) {
          loaderVersionsError.value = `Нет версий ${offlineForm.value.modLoader} для Minecraft ${offlineForm.value.mcVersion}`
        }
      },
    })
  }

  const selectKind = async (value: ProfileKind): Promise<void> => {
    kind.value = value
    errorMessage.value = ''
    mcVersionsError.value = ''
    loaderVersionsError.value = ''

    if (value === 'offline' && mcVersions.value.length === 0) {
      await loadMcVersions()
    }
  }

  const submitOffline = async (): Promise<ProjectConfig | null> => {
    if (isSubmitting.value) return null
    if (!isOfflineValid.value) return null

    const created = await runScopedAction({
      busyFlag: isSubmitting,
      errorTarget: errorMessage,
      errorMessage: 'Не удалось создать профиль',
      run: (): Promise<ProjectConfig> => createOfflineProfile(
        offlineForm.value.name.trim(),
        offlineForm.value.mcVersion,
        offlineForm.value.modLoader,
        needsLoaderVersion.value ? offlineForm.value.loaderVersion : null,
      ),
      apply: async (config: ProjectConfig): Promise<ProjectConfig> => {
        await applyCreatedProfile(config)
        offlineForm.value.name = ''
        notification.show(`Профиль "${config.projectName}" создан`)
        return config
      },
    })
    return created ?? null
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
    mcVersionsError,
    loaderVersionsError,
    isOfflineValid,
    selectKind,
    submitOffline,
  }
}
