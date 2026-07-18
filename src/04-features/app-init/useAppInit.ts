import {onBeforeMount, ref} from 'vue'
import {useCoreStore} from '@/05-entities'
import {getAppInitData, checkUpdate, applyUpdateCmd, loadSettingsProject, saveSettingsProject} from '@/06-shared/api'
import {useRouter} from 'vue-router'
import type {ProjectConfig} from '@/05-entities/core/types'

const defaultProjectConfig: ProjectConfig = {
    projectName: 'Cordelia',
    mcVersion: '1.21.1',
    modLoader: 'neoforge',
    loaderVersion: null,
    javaPath: null,
    jvmArgs: [],
    minMemory: '-Xms512M',
    maxMemory: '-Xmx4G',
    online: true,
    initialized: false,
}

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
            }

            if (!coreStore.launcherConfig) {
                router.replace('/setup')
                return
            }

            try {
                await loadSettingsProject('Cordelia')
            } catch (e: unknown) {
                await saveSettingsProject(defaultProjectConfig)
                console.error('Ошибка загрузки конфига:', e)
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
