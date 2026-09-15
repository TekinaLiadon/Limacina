import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountsStore, useCoreStore, useNotificationStore, useProjectSettingsStore, type ProjectSettingsForm } from '@/05-entities'
import { authLogins, clearMinecraftConfig, deleteProject, getErrorMessage, getServerConnectUrl, loadSettingsProject, refreshManifests, saveSettingsProject } from '@/06-shared/api'
import { copyToClipboard, reportError } from '@/06-shared'
import { useProjectSwitch } from '@/04-features'
import { open } from '@tauri-apps/plugin-dialog'
import type { ProjectConfig } from '@/05-entities/core/types'
import { splitJvmArgs } from './jvmPresets'

export function useProjectSettings(): {
  config: ComputedRef<ProjectSettingsForm>
  isLoaded: ComputedRef<boolean>
  maxMemoryLimit: ComputedRef<number>
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
} {
  const coreStore = useCoreStore()
  const accountsStore = useAccountsStore()
  const notification = useNotificationStore()
  const store = useProjectSettingsStore()
  const router = useRouter()
  const { resetAccountsState } = useProjectSwitch()

  const config = computed((): ProjectSettingsForm => store.config)
  const isLoaded = computed((): boolean => store.isLoaded)
  const isSaving = computed((): boolean => store.isSaving)

  const maxMemoryLimit = computed((): number => {
    return Math.max(512, coreStore.totalMemoryMb - 2048)
  })

  const DEFAULT_MIN_MEMORY = 512
  const DEFAULT_MAX_MEMORY = 4096

  const parseMemory = (val: string | null | undefined, fallback: number): number => {
    if (!val) return fallback
    const num = parseInt(val.replace(/[^0-9]/g, ''), 10)
    if (Number.isNaN(num)) return fallback
    const mb = val.toUpperCase().includes('G') ? num * 1024 : num
    return Number.isFinite(mb) ? mb : fallback
  }

  const selectJavaFolder = async (): Promise<void> => {
    const selected = await open({ directory: true })
    if (selected) config.value.javaPath = selected
  }

  const loadConfig = async (project: string, force: boolean = false): Promise<void> => {
    if (!project) return
    if (!force && (store.loadedProject === project || store.loadingProject === project)) return

    store.startLoading(project)
    try {
      const loaded = await loadSettingsProject(project)
      store.applyLoaded(project, {
        projectName: loaded.projectName,
        mcVersion: loaded.mcVersion,
        modLoader: loaded.modLoader,
        loaderVersion: loaded.loaderVersion ?? '',
        javaPath: loaded.javaPath ?? '',
        javaVersion: loaded.javaVersion ?? null,
        jvmArgs: (loaded.jvmArgs ?? []).join(', '),
        memoryRange: [parseMemory(loaded.minMemory, DEFAULT_MIN_MEMORY), parseMemory(loaded.maxMemory, DEFAULT_MAX_MEMORY)],
        online: loaded.online,
        initialized: loaded.initialized,
        serverUrl: loaded.serverUrl,
        autoJoinServer: loaded.autoJoinServer,
      })
    } catch (e: unknown) {
      reportError('Не удалось загрузить настройки проекта', e)
    } finally {
      store.finishLoading()
    }
  }

  const serverConnectUrl = ref<string>('')
  const isLoadingConnectUrl = ref<boolean>(false)

  watch(() => coreStore.currentProject, (project: string) => {
    serverConnectUrl.value = ''
    loadConfig(project)
  }, { immediate: true })

  const handleSave = async (): Promise<void> => {
    store.startSaving()

    try {
      const projectConfig: ProjectConfig = {
        projectName: config.value.projectName,
        mcVersion: config.value.mcVersion,
        modLoader: config.value.modLoader,
        loaderVersion: config.value.loaderVersion || null,
        javaPath: config.value.javaPath || null,
        javaVersion: config.value.javaVersion,
        jvmArgs: config.value.jvmArgs ? splitJvmArgs(config.value.jvmArgs) : [],
        minMemory: `-Xms${config.value.memoryRange[0]}M`,
        maxMemory: `-Xmx${config.value.memoryRange[1]}M`,
        online: config.value.online,
        initialized: coreStore.projectConfig?.initialized ?? config.value.initialized,
        serverUrl: config.value.serverUrl,
        autoJoinServer: config.value.autoJoinServer,
      }
      await saveSettingsProject(projectConfig)
      notification.show('Настройки сохранены')
    } catch (e: unknown) {
      notification.show(String(e))
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
      notification.show(String(e))
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
      notification.show(String(e))
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
      notification.show(String(e))
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
    if (accountsStore.isLaunching) {
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

      coreStore.currentProject = next
      coreStore.projectConfig = await loadSettingsProject(next)
      accountsStore.logins = await authLogins(next)
    } catch (e: unknown) {
      notification.show(String(e))
    } finally {
      isDeleting.value = false
    }
  }

  return {
    config,
    isLoaded,
    maxMemoryLimit,
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
  }
}
