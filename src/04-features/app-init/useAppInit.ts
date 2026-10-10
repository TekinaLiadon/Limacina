import { onBeforeMount, ref } from 'vue'
import { useCoreStore, useSettingsStore, useNotificationStore, useProjectSettingsStore, normalizeTheme, type AppInitData, type UpdateInfo } from '@/05-entities'
import { applyUpdateCmd, checkUpdate, getAppInitData, getErrorMessage } from '@/06-shared/api'
import { captureProjectScope, reportError } from '@/06-shared'
import { useRouter } from 'vue-router'
import { preloadThemeFonts } from '@/04-features/theme/preloadThemeFonts'
import { loadProjectConfig } from '@/04-features/project-settings/loadProjectConfig'

const STARTUP_ERROR_DURATION = 5000

export function useAppInit() {
  const coreStore = useCoreStore()
  const settingsStore = useSettingsStore()
  const notification = useNotificationStore()
  const router = useRouter()
  const preloaderText = ref<string>('')
  const startupError = ref<string>('')
  let isInitializing = false

  const showStartupError = (message: string, e: unknown): void => {
    reportError(message, e)
    const detail = getErrorMessage(e)
    notification.show(detail ? `${message}: ${detail}` : message, STARTUP_ERROR_DURATION)
  }

  const loadProject = async (name: string): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    const loaded = await loadProjectConfig(name)
    if (!scope.isCurrent()) return
    if (!loaded) {
      startupError.value = useProjectSettingsStore().loadError || 'Не удалось загрузить конфиг проекта'
      return
    }
    startupError.value = ''
  }

  const applyInitData = (data: AppInitData): void => {
    coreStore.launcherName = data.launcherName
    coreStore.defaultParentPath = data.defaultParentPath
    coreStore.launcherConfig = data.launcherConfig
    coreStore.version = data.version
    coreStore.totalMemoryMb = data.totalMemoryMb
    coreStore.offlineBuild = data.offlineBuild
    coreStore.envProjectName = data.envProjectName ?? ''

    if (!data.launcherConfig) return

    coreStore.applyLauncherProjects(data.launcherConfig)
    settingsStore.markThemeHydration(data.launcherConfig.theme)
    settingsStore.setTheme(normalizeTheme(data.launcherConfig.theme))
    settingsStore.setAnimationsEnabled(data.launcherConfig.animationsEnabled)
  }

  const init = async (): Promise<void> => {
    if (isInitializing) return
    isInitializing = true
    const startTime: number = Date.now()
    void preloadThemeFonts().catch((e: unknown): void => {
      reportError('Не удалось предзагрузить шрифты', e)
    })
    try {
      const initData = await getAppInitData()
      applyInitData(initData)

      const autoUpdate = initData.launcherConfig?.autoUpdate ?? false
      const isUpdateCheckEnabled = autoUpdate && !coreStore.offlineBuild

      const loadedProject: string | null = coreStore.currentProject
      let projectLoad: Promise<void> = loadedProject ? loadProject(loadedProject) : Promise.resolve()

      if (isUpdateCheckEnabled) {
        preloaderText.value = 'Проверка обновлений...'
        let updateInfo: UpdateInfo | null = null
        try {
          updateInfo = await checkUpdate()
        } catch (e: unknown) {
          showStartupError('Не удалось проверить обновления', e)
        }

        if (updateInfo) {
          preloaderText.value = `Скачивание обновления до v${updateInfo.version}...`
          try {
            await applyUpdateCmd()
          } catch (e: unknown) {
            showStartupError('Не удалось обновить лаунчер', e)
          }

          preloaderText.value = 'Обновление завершено, загрузка...'
          const freshData = await getAppInitData()
          applyInitData(freshData)
          const activeProject = coreStore.currentProject
          if (activeProject && activeProject !== loadedProject) {
            projectLoad = loadProject(activeProject)
          }
        }
      }

      if (!coreStore.launcherConfig) {
        router.replace('/setup')
        return
      }

      if (coreStore.needsOfflineSetup) {
        router.replace({ name: 'Setup' })
        return
      }

      await projectLoad
    } catch (e: unknown) {
      reportError('Ошибка инициализации', e)
      startupError.value = getErrorMessage(e)
    } finally {
      const elapsed: number = Date.now() - startTime
      const remaining: number = Math.max(0, 1000 - elapsed)
      setTimeout(() => {
        coreStore.isLoading = false
        isInitializing = false
      }, remaining)
    }
  }

  const retryInit = async (): Promise<void> => {
    if (isInitializing) return
    startupError.value = ''
    coreStore.isLoading = true
    await init()
  }

  onBeforeMount(() => {
    init()
  })

  return {
    preloaderText,
    startupError,
    retryInit,
  }
}
