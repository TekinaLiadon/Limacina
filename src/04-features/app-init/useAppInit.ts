import { onBeforeMount, ref } from 'vue'
import { useCoreStore, useSettingsStore, useNotificationStore, normalizeTheme, type LauncherConfig, type ProjectConfig, type UpdateInfo } from '@/05-entities'
import { applyUpdateCmd, checkUpdate, getAppInitData, getErrorMessage, loadSettingsProject } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import { useRouter } from 'vue-router'
import { preloadThemeFonts } from '@/04-features/theme/preloadThemeFonts'

const STARTUP_ERROR_DURATION = 5000

export function useAppInit() {
  const coreStore = useCoreStore()
  const settingsStore = useSettingsStore()
  const notification = useNotificationStore()
  const router = useRouter()
  const preloaderText = ref<string>('')
  const startupError = ref<string>('')

  const showStartupError = (message: string, e: unknown): void => {
    reportError(message, e)
    const detail = getErrorMessage(e)
    notification.show(detail ? `${message}: ${detail}` : message, STARTUP_ERROR_DURATION)
  }

  const applyProjects = (config: LauncherConfig): void => {
    coreStore.projects = [...config.projectNames]
    const [first] = coreStore.projects
    if (first === undefined) return

    const saved = config.currentProject
    coreStore.currentProject = saved && coreStore.projects.includes(saved)
      ? saved
      : first
  }

  const loadProject = (name: string): Promise<void> =>
    loadSettingsProject(name)
      .then((config: ProjectConfig): void => {
        coreStore.projectConfig = config
        startupError.value = ''
      })
      .catch((e: unknown): void => {
        reportError('Не удалось загрузить конфиг проекта', e)
        startupError.value = getErrorMessage(e) || 'Не удалось загрузить конфиг проекта'
      })

  const init = async (): Promise<void> => {
    const startTime: number = Date.now()
    void preloadThemeFonts().catch((e: unknown): void => {
      reportError('Не удалось предзагрузить шрифты', e)
    })
    try {
      const initData = await getAppInitData()
      coreStore.launcherName = initData.launcherName
      coreStore.defaultParentPath = initData.defaultParentPath
      coreStore.launcherConfig = initData.launcherConfig
      coreStore.hasLauncherConfig = !!initData.launcherConfig
      coreStore.version = initData.version
      coreStore.totalMemoryMb = initData.totalMemoryMb
      coreStore.offlineBuild = initData.offlineBuild
      coreStore.envProjectName = initData.envProjectName ?? ''

      if (initData.launcherConfig) {
        applyProjects(initData.launcherConfig)

        const savedTheme = normalizeTheme(initData.launcherConfig.theme)
        settingsStore.setTheme(savedTheme)
        settingsStore.setAnimationsEnabled(initData.launcherConfig.animationsEnabled)
      }

      const autoUpdate = initData.launcherConfig?.autoUpdate ?? true
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
          coreStore.version = freshData.version
          coreStore.launcherConfig = freshData.launcherConfig
          coreStore.hasLauncherConfig = !!freshData.launcherConfig
          if (freshData.launcherConfig) {
            applyProjects(freshData.launcherConfig)

            const refreshedTheme = normalizeTheme(freshData.launcherConfig.theme)
            settingsStore.setTheme(refreshedTheme)
            settingsStore.setAnimationsEnabled(freshData.launcherConfig.animationsEnabled)
          }
          if (coreStore.currentProject && coreStore.currentProject !== loadedProject) {
            projectLoad = loadProject(coreStore.currentProject)
          }
        }
      }

      if (!coreStore.launcherConfig) {
        router.replace('/setup')
        return
      }

      if (coreStore.offlineBuild && coreStore.projects.length === 0) {
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
      }, remaining)
    }
  }

  const retryInit = async (): Promise<void> => {
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
