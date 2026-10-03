import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  useCoreStore,
  useNotificationStore,
  useLaunchStore,
  useProjectSettingsStore,
  projectSettingsFormFromConfig,
  type ProjectSettingsForm,
  type ProjectConfig,
} from '@/05-entities'
import { clearMinecraftConfig, deleteProject, getErrorMessage, getServerConnectUrl, loadSettingsProject, refreshManifests, saveSettingsProject } from '@/06-shared/api'
import { copyToClipboard, selectDirectory } from '@/06-shared'
import { useProjectSwitch } from '@/04-features'
import { loadProjectConfig } from './loadProjectConfig'
import { splitJvmArgs, validateJvmArgs } from './jvmPresets'

export function useProjectSettings(): {
  config: ComputedRef<ProjectSettingsForm>
  isLoaded: ComputedRef<boolean>
  isLoading: ComputedRef<boolean>
  loadError: ComputedRef<string>
  isDirty: ComputedRef<boolean>
  maxMemoryLimit: ComputedRef<number>
  jvmArgsError: ComputedRef<string>
  isSaving: ComputedRef<boolean>
  isClearingConfig: Ref<boolean>
  isRefreshingManifests: Ref<boolean>
  isDeleting: Ref<boolean>
  canDeleteProject: ComputedRef<boolean>
  serverConnectUrl: Ref<string>
  isLoadingConnectUrl: Ref<boolean>
  selectJavaFolder: () => Promise<void>
  handleSave: () => Promise<void>
  handleClearMinecraftConfig: () => Promise<void>
  handleRefreshManifests: () => Promise<void>
  handleDeleteProject: () => Promise<void>
  handleGetConnectUrl: () => Promise<void>
  handleCopyConnectUrl: () => Promise<void>
  loadConfig: (project: string, force?: boolean) => Promise<void>
  retryLoad: () => Promise<void>} {
  const coreStore = useCoreStore()
  const launchStore = useLaunchStore()
  const notification = useNotificationStore()
  const store = useProjectSettingsStore()
  const router = useRouter()
  const { resetAccountsState, applyProjectSwitch } = useProjectSwitch()

  const config = computed((): ProjectSettingsForm => store.config)
  const isLoaded = computed((): boolean => store.isLoaded)
  const isLoading = computed((): boolean => store.loadingProject !== '')
  const loadError = computed((): string => store.loadError)
  const isSaving = computed((): boolean => store.isSaving)
  const isDirty = computed((): boolean => store.isDirty)

  const maxMemoryLimit = computed((): number => {
    return Math.max(512, coreStore.totalMemoryMb - 2048)
  })

  const jvmArgsError = computed((): string => validateJvmArgs(config.value.jvmArgs))

  const selectJavaFolder = async (): Promise<void> => {
    const selected = await selectDirectory()
    if (selected) config.value.javaPath = selected
  }

  const loadConfig = async (project: string, force: boolean = false): Promise<void> => {
    await loadProjectConfig(project, force)
  }

  const retryLoad = (): Promise<void> => loadConfig(coreStore.currentProject, true)

  const serverConnectUrl = ref<string>('')
  const isLoadingConnectUrl = ref<boolean>(false)

  watch(() => coreStore.currentProject, (project: string) => {
    serverConnectUrl.value = ''
    void loadProjectConfig(project)
  }, { immediate: true })

  const handleSave = async (): Promise<void> => {
    if (!store.isLoaded) return
    if (store.isSaving) return
    if (store.isFieldDirty('jvmArgs') && jvmArgsError.value) {
      notification.show(jvmArgsError.value)
      return
    }
    const { projectName } = config.value
    store.startSaving()

    try {
      const fresh = await loadSettingsProject(projectName)
      if (coreStore.currentProject !== projectName) return
      const projectConfig: ProjectConfig = {
        ...fresh,
        loaderVersion: store.isFieldDirty('loaderVersion') ? config.value.loaderVersion || null : fresh.loaderVersion,
        javaPath: store.isFieldDirty('javaPath') ? config.value.javaPath || null : fresh.javaPath,
        jvmArgs: store.isFieldDirty('jvmArgs') ? (config.value.jvmArgs ? splitJvmArgs(config.value.jvmArgs) : []) : fresh.jvmArgs,
        minMemory: store.isFieldDirty('memoryRange') ? `-Xms${config.value.memoryRange[0]}M` : fresh.minMemory,
        maxMemory: store.isFieldDirty('memoryRange') ? `-Xmx${config.value.memoryRange[1]}M` : fresh.maxMemory,
        autoJoinServer: store.isFieldDirty('autoJoinServer') ? config.value.autoJoinServer : fresh.autoJoinServer,
      }
      await saveSettingsProject(projectConfig)
      if (coreStore.currentProject !== projectName) return
      coreStore.projectConfig = projectConfig
      store.adoptLoaded(projectName, projectSettingsFormFromConfig(projectConfig))
      notification.show('Настройки сохранены')
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      store.finishSaving()
    }
  }

  const isRefreshingManifests = ref<boolean>(false)

  const handleGetConnectUrl = async (): Promise<void> => {
    if (isLoadingConnectUrl.value) return
    isLoadingConnectUrl.value = true
    try {
      serverConnectUrl.value = await getServerConnectUrl()
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isLoadingConnectUrl.value = false
    }
  }

  const handleCopyConnectUrl = async (): Promise<void> => {
    if (!serverConnectUrl.value) return
    try {
      await copyToClipboard(serverConnectUrl.value)
      notification.show('Ссылка скопирована')
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    }
  }

  const isClearingConfig = ref<boolean>(false)

  const handleClearMinecraftConfig = async (): Promise<void> => {
    const confirmed = await notification.confirm(
      'Удалить папку конфигов игры? При включённом сохранении старых конфигов она будет переименована вместо удаления'
    )
    if (!confirmed) return

    isClearingConfig.value = true
    try {
      const message = await clearMinecraftConfig()
      notification.show(message)
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isClearingConfig.value = false
    }
  }

  const handleRefreshManifests = async (): Promise<void> => {
    if (isRefreshingManifests.value) return
    isRefreshingManifests.value = true
    try {
      const message = await refreshManifests()
      notification.show(message)
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isRefreshingManifests.value = false
    }
  }

  const isDeleting = ref<boolean>(false)

  const canDeleteProject = computed((): boolean =>
    coreStore.envProjectName === '' || coreStore.currentProject !== coreStore.envProjectName
  )

  const handleDeleteProject = async (): Promise<void> => {
    if (isDeleting.value) return
    const projectName = coreStore.currentProject
    if (!projectName) return
    if (coreStore.gameUsername) {
      notification.show('Нельзя удалить проект, пока запущена игра')
      return
    }
    if (launchStore.isLaunching) {
      notification.show('Дождитесь завершения запуска игры')
      return
    }

    const confirmed = await notification.confirm(
      `Удалить проект «${projectName}»? Папка с игрой, модами, конфигами и сохранениями будет удалена безвозвратно`
    )
    if (!confirmed) return

    isDeleting.value = true
    try {
      const launcherConfig = await deleteProject()
      coreStore.launcherConfig = launcherConfig
      coreStore.projects = [...launcherConfig.projectNames]
      resetAccountsState()
      notification.show('Проект удалён')

      const [next] = coreStore.projects
      if (next === undefined) {
        coreStore.currentProject = ''
        coreStore.projectConfig = null
        await router.push({ name: 'AddProfile' })
        return
      }

      try {
        await applyProjectSwitch(next)
      } catch (e: unknown) {
        coreStore.currentProject = next
        coreStore.projectConfig = null
        notification.show(getErrorMessage(e))
      }
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isDeleting.value = false
    }
  }

  return {
    config,
    isLoaded,
    isLoading,
    loadError,
    isDirty,
    maxMemoryLimit,
    jvmArgsError,
    isSaving,
    isClearingConfig,
    isRefreshingManifests,
    isDeleting,
    canDeleteProject,
    serverConnectUrl,
    isLoadingConnectUrl,
    selectJavaFolder,
    handleSave,
    handleClearMinecraftConfig,
    handleRefreshManifests,
    handleDeleteProject,
    handleGetConnectUrl,
    handleCopyConnectUrl,
    loadConfig,
    retryLoad,
  }
}
