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
import { clearMinecraftConfig, deleteProject, getErrorMessage, getServerConnectUrl, loadSettingsProject, probeJava, refreshManifests, saveSettingsProject } from '@/06-shared/api'
import { captureProjectScope, copyToClipboard, reportError, selectDirectory, useAsyncAction } from '@/06-shared'
import { useProjectSwitch } from '@/04-features/project-switch/useProjectSwitch'
import { loadProjectConfig } from './loadProjectConfig'
import { splitJvmArgs, validateJvmArgs } from './jvmPresets'

const MIN_MEMORY_LIMIT_MB = 512
const OS_MEMORY_RESERVE_MB = 2048

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
  const { resetAccountsState, applyProjectSwitch, isSwitching } = useProjectSwitch()

  const config = computed((): ProjectSettingsForm => store.config)
  const isLoaded = computed((): boolean => store.isLoaded)
  const isLoading = computed((): boolean => store.loadingProject !== '')
  const loadError = computed((): string => store.loadError)
  const isSaving = computed((): boolean => store.isSaving)
  const isDirty = computed((): boolean => store.isDirty)

  const maxMemoryLimit = computed((): number => {
    return Math.max(MIN_MEMORY_LIMIT_MB, coreStore.totalMemoryMb - OS_MEMORY_RESERVE_MB)
  })

  const jvmArgsError = computed((): string => validateJvmArgs(config.value.jvmArgs))

  const selectJavaFolder = async (): Promise<void> => {
    const selected = await selectDirectory()
    if (!selected) return
    try {
      const probe = await probeJava(selected)
      config.value.javaPath = probe.javaPath
      config.value.javaVersion = probe.javaVersion
    } catch (e: unknown) {
      reportError('Не удалось проверить версию Java', e)
      notification.show(getErrorMessage(e))
    }
  }

  const loadConfig = async (project: string, force: boolean = false): Promise<void> => {
    await loadProjectConfig(project, force)
  }

  const retryLoad = (): Promise<void> => loadConfig(coreStore.currentProject, true)

  const serverConnectUrl = ref<string>('')
  const isLoadingConnectUrl = ref<boolean>(false)

  const reportAndNotify = (message: string) => (e: unknown): void => {
    reportError(message, e)
    notification.show(getErrorMessage(e))
  }

  const connectUrlAction = useAsyncAction(reportAndNotify('Не удалось получить ссылку для подключения'), isLoadingConnectUrl)

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
    const scope = captureProjectScope((): string => coreStore.currentProject)
    store.startSaving()

    try {
      const fresh = await loadSettingsProject(projectName)
      if (!scope.isCurrent()) return
      const projectConfig: ProjectConfig = {
        ...fresh,
        loaderVersion: store.isFieldDirty('loaderVersion') ? config.value.loaderVersion || null : fresh.loaderVersion,
        javaPath: store.isFieldDirty('javaPath') ? config.value.javaPath || null : fresh.javaPath,
        jvmArgs: store.isFieldDirty('jvmArgs') ? (config.value.jvmArgs ? splitJvmArgs(config.value.jvmArgs) : []) : fresh.jvmArgs,
        minMemory: store.isFieldDirty('memoryRange') ? `-Xms${config.value.memoryRange[0]}M` : fresh.minMemory,
        maxMemory: store.isFieldDirty('memoryRange') ? `-Xmx${config.value.memoryRange[1]}M` : fresh.maxMemory,
        autoJoinServer: store.isFieldDirty('autoJoinServer') ? config.value.autoJoinServer : fresh.autoJoinServer,
      }
      const saved = await saveSettingsProject(projectConfig)
      if (!scope.isCurrent()) return
      coreStore.setProjectConfig(saved)
      store.adoptLoaded(projectName, projectSettingsFormFromConfig(saved))
      notification.show('Настройки сохранены')
    } catch (e: unknown) {
      reportError('Не удалось сохранить настройки проекта', e)
      notification.show(getErrorMessage(e))
    } finally {
      store.finishSaving()
    }
  }

  const handleGetConnectUrl = async (): Promise<void> => {
    await connectUrlAction.run(async () => {
      serverConnectUrl.value = await getServerConnectUrl()
    })
  }

  const copyConnectUrlAction = useAsyncAction(reportAndNotify('Не удалось скопировать ссылку'))

  const handleCopyConnectUrl = async (): Promise<void> => {
    if (!serverConnectUrl.value) return
    await copyConnectUrlAction.run(async () => {
      await copyToClipboard(serverConnectUrl.value)
      notification.show('Ссылка скопирована')
    })
  }

  const isClearingConfig = ref<boolean>(false)
  const clearConfigAction = useAsyncAction(reportAndNotify('Не удалось очистить конфиги игры'), isClearingConfig)

  const guardProjectSwitching = (): boolean => {
    if (!isSwitching.value) return false
    notification.show('Дождитесь завершения смены проекта')
    return true
  }

  const handleClearMinecraftConfig = async (): Promise<void> => {
    if (guardProjectSwitching()) return
    const scope = captureProjectScope((): string => coreStore.currentProject)
    const confirmed = await notification.confirm(
      'Удалить папку конфигов игры? При включённом сохранении старых конфигов она будет переименована вместо удаления'
    )
    if (!confirmed) return
    if (!scope.isCurrent()) {
      notification.show('Проект сменился, очистка конфигов отменена')
      return
    }

    await clearConfigAction.run(async () => {
      const message = await clearMinecraftConfig(scope.project)
      notification.show(message)
    })
  }

  const isRefreshingManifests = ref<boolean>(false)
  const manifestsAction = useAsyncAction(reportAndNotify('Не удалось обновить манифесты'), isRefreshingManifests)

  const handleRefreshManifests = async (): Promise<void> => {
    if (guardProjectSwitching()) return
    await manifestsAction.run(async () => {
      const message = await refreshManifests()
      notification.show(message)
    })
  }

  const isDeleting = ref<boolean>(false)
  const deleteAction = useAsyncAction(reportAndNotify('Не удалось удалить проект'), isDeleting)

  const canDeleteProject = computed((): boolean => {
    const { envProjectName } = coreStore
    return envProjectName === '' || envProjectName !== coreStore.currentProject
  })

  const handleDeleteProject = async (): Promise<void> => {
    if (isDeleting.value) return
    const projectName = coreStore.currentProject
    if (!projectName) return
    if (launchStore.gameUsernames.length > 0) {
      notification.show('Нельзя удалить проект, пока запущена игра')
      return
    }
    if (launchStore.isLaunching) {
      notification.show('Дождитесь завершения запуска игры')
      return
    }
    if (guardProjectSwitching()) return

    const scope = captureProjectScope((): string => coreStore.currentProject)
    const confirmed = await notification.confirm(
      `Удалить проект "${projectName}"? Папка с игрой, модами, конфигами и сохранениями будет удалена безвозвратно`
    )
    if (!confirmed) return
    if (!scope.isCurrent()) {
      notification.show('Проект сменился, удаление отменено')
      return
    }

    await deleteAction.run(async () => {
      coreStore.setLauncherConfig(await deleteProject(scope.project))
      resetAccountsState()
      notification.show('Проект удалён')

      const [next] = coreStore.projects
      if (next === undefined) {
        coreStore.setProjectConfig(null)
        await router.push({ name: 'AddProfile' })
        return
      }

      try {
        await applyProjectSwitch(next)
      } catch (e: unknown) {
        reportError('Не удалось переключиться на следующий проект после удаления', e)
        coreStore.setProjectConfig(null)
        notification.show(getErrorMessage(e))
      }
    })
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
