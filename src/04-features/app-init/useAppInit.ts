import {onBeforeMount, ref} from 'vue'
import {useCoreStore, useSettingsStore, normalizeTheme} from '@/05-entities'
import {getAppInitData, checkUpdate, applyUpdateCmd, loadSettingsProject} from '@/06-shared/api'
import {useRouter} from 'vue-router'
import type {LauncherConfig} from '@/05-entities/core/types'
import {preloadThemeFonts} from '@/04-features/theme/preloadThemeFonts'

export function useAppInit() {
    const coreStore = useCoreStore()
    const settingsStore = useSettingsStore()
    const router = useRouter()
    const preloaderText = ref<string>('')

    const applyProjects = (config: LauncherConfig): void => {
        coreStore.projects = [...config.projectNames]
        if (coreStore.projects.length === 0) return

        const saved = config.currentProject
        coreStore.currentProject = saved && coreStore.projects.includes(saved)
            ? saved
            : coreStore.projects[0]
    }

    const init = async (): Promise<void> => {
        const startTime: number = Date.now()
        void preloadThemeFonts().catch((e: unknown): void => {
            console.error('Не удалось предзагрузить шрифты:', e)
        })
        try {
            const initData = await getAppInitData()
            coreStore.launcherName = initData.launcherName
            coreStore.defaultParentPath = initData.defaultParentPath
            coreStore.launcherConfig = initData.launcherConfig
            coreStore.hasLauncherConfig = !!initData.launcherConfig
            coreStore.version = initData.version
            coreStore.totalMemoryMb = initData.totalMemoryMb

            if (initData.launcherConfig) {
                applyProjects(initData.launcherConfig)

                const savedTheme = normalizeTheme(initData.launcherConfig.theme)
                settingsStore.setTheme(savedTheme)
                settingsStore.setAnimationsEnabled(initData.launcherConfig.animationsEnabled)
            }

            const autoUpdate = initData.launcherConfig?.autoUpdate ?? true
            if (autoUpdate) {
                preloaderText.value = 'Проверка обновлений...'
                const updateInfo = await checkUpdate()
                if (updateInfo) {
                    preloaderText.value = `Скачивание обновления до v${updateInfo.version}...`
                    try {
                        await applyUpdateCmd()
                    } catch (e: unknown) {
                        console.error('Ошибка применения обновления:', e)
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
                }
            }

            if (!coreStore.launcherConfig) {
                router.replace('/setup')
                return
            }

            if (coreStore.currentProject) {
                try {
                    coreStore.projectConfig = await loadSettingsProject(coreStore.currentProject)
                } catch (e: unknown) {
                    console.error('Не удалось загрузить конфиг проекта:', e)
                }
            }
        } catch (e: unknown) {
            console.error('Ошибка инициализации:', e)
        } finally {
            const elapsed: number = Date.now() - startTime
            const remaining: number = Math.max(0, 1000 - elapsed)
            setTimeout(() => {
                coreStore.isLoading = false
            }, remaining)
        }
    }

    onBeforeMount(() => {
        init()
    })

    return {
        preloaderText,
    }
}
