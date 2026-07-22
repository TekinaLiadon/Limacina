import {onBeforeMount, ref} from 'vue'
import {useCoreStore} from '@/05-entities'
import {getAppInitData, checkUpdate, applyUpdateCmd} from '@/06-shared/api'
import {useRouter} from 'vue-router'

export function useAppInit() {
    const coreStore = useCoreStore()
    const router = useRouter()
    const preloaderText = ref<string>('')

    const init = async (): Promise<void> => {
        const startTime: number = Date.now()
        try {
            const initData = await getAppInitData()
            coreStore.launcherName = initData.launcherName
            coreStore.defaultParentPath = initData.defaultParentPath
            coreStore.launcherConfig = initData.launcherConfig
            coreStore.hasLauncherConfig = !!initData.launcherConfig
            coreStore.version = initData.version
            coreStore.totalMemoryMb = initData.totalMemoryMb

            if (initData.launcherConfig) {
                coreStore.projects = [...initData.launcherConfig.projectNames]
                if (coreStore.projects.length > 0) {
                    coreStore.currentProject = coreStore.projects[0]
                }
            }

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
                    coreStore.projects = [...freshData.launcherConfig.projectNames]
                    if (freshData.launcherConfig.projectNames.length > 0 && !coreStore.currentProject) {
                        coreStore.currentProject = freshData.launcherConfig.projectNames[0]
                    }
                }
            }

            if (!coreStore.launcherConfig) {
                router.replace('/setup')
                return
            }
        } catch (e: unknown) {
            console.error('Ошибка инициализации:', e)
        } finally {
            const elapsed: number = Date.now() - startTime
            const remaining: number = Math.max(0, 2000 - elapsed)
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
