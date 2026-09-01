import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, useProjectSettingsStore } from '@/05-entities'
import type { ProjectSettingsForm } from '@/05-entities'
import { loadSettingsProject, saveSettingsProject, refreshManifests } from '@/06-shared/api'
import { open } from '@tauri-apps/plugin-dialog'
import type { ProjectConfig } from '@/05-entities/core/types'

export function useProjectSettings(): {
  config: ComputedRef<ProjectSettingsForm>
  isLoaded: ComputedRef<boolean>
  maxMemoryLimit: ComputedRef<number>
  isSaving: ComputedRef<boolean>
  isRefreshingManifests: Ref<boolean>
  selectJavaFolder: () => Promise<void>
  handleSave: () => Promise<void>
  handleRefreshManifests: () => Promise<void>
  loadConfig: (project: string, force?: boolean) => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const store = useProjectSettingsStore()

  const config = computed((): ProjectSettingsForm => store.config)
  const isLoaded = computed((): boolean => store.isLoaded)
  const isSaving = computed((): boolean => store.isSaving)

  const maxMemoryLimit = computed((): number => {
    return Math.max(512, coreStore.totalMemoryMb - 2048)
  })

  const parseMemory = (val: string): number => {
    const num = parseInt(val.replace(/[^0-9]/g, ''), 10)
    if (val.toUpperCase().includes('G')) return num * 1024
    return num
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
        jvmArgs: (loaded.jvmArgs ?? []).join(', '),
        memoryRange: [parseMemory(loaded.minMemory), parseMemory(loaded.maxMemory)],
        online: loaded.online,
        initialized: loaded.initialized,
        serverUrl: loaded.serverUrl,
      })
    } catch (e: unknown) {
      console.error(e)
    } finally {
      store.finishLoading()
    }
  }

  watch(() => coreStore.currentProject, (project: string) => {
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
        jvmArgs: config.value.jvmArgs ? config.value.jvmArgs.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        minMemory: `-Xms${config.value.memoryRange[0]}M`,
        maxMemory: `-Xmx${config.value.memoryRange[1]}M`,
        online: config.value.online,
        initialized: config.value.initialized,
        serverUrl: config.value.serverUrl,
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

  const handleRefreshManifests = async (): Promise<void> => {
    if (isRefreshingManifests.value) return
    isRefreshingManifests.value = true
    try {
      const message = await refreshManifests()
      notification.show(message)
    } catch (e: unknown) {
      notification.show(e instanceof Error ? e.message : String(e))
    } finally {
      isRefreshingManifests.value = false
    }
  }

  return {
    config,
    isLoaded,
    maxMemoryLimit,
    isSaving,
    isRefreshingManifests,
    selectJavaFolder,
    handleSave,
    handleRefreshManifests,
    loadConfig,
  }
}
