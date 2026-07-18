import { ref, computed, watch } from 'vue'
import { useCoreStore, useNotificationStore } from '@/05-entities'
import { loadSettingsProject, saveSettingsProject } from '@/06-shared/api'
import { open } from '@tauri-apps/plugin-dialog'
import type { ProjectConfig } from '@/05-entities/core/types'

interface SettingsForm {
  projectName: string
  mcVersion: string
  modLoader: string
  loaderVersion: string
  javaPath: string
  jvmArgs: string
  memoryRange: [number, number]
  online: boolean
  initialized: boolean
}

export function useProjectSettings() {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const isSaving = ref<boolean>(false)
  const isLoaded = ref<boolean>(false)

  const config = ref<SettingsForm>({
    projectName: '',
    mcVersion: '',
    modLoader: '',
    loaderVersion: '',
    javaPath: '',
    jvmArgs: '',
    memoryRange: [512, 4096],
    online: true,
    initialized: false,
  })

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

  const loadConfig = async (project: string): Promise<void> => {
    if (!project) return
    isLoaded.value = false
    try {
      const loaded = await loadSettingsProject(project)
      config.value = {
        projectName: loaded.projectName,
        mcVersion: loaded.mcVersion,
        modLoader: loaded.modLoader,
        loaderVersion: loaded.loaderVersion ?? '',
        javaPath: loaded.javaPath ?? '',
        jvmArgs: (loaded.jvmArgs ?? []).join(', '),
        memoryRange: [parseMemory(loaded.minMemory), parseMemory(loaded.maxMemory)],
        online: loaded.online,
        initialized: loaded.initialized,
      }
      isLoaded.value = true
    } catch (e: unknown) {
      console.error(e)
    }
  }

  watch(() => coreStore.currentProject, (project: string) => {
    loadConfig(project)
  }, { immediate: true })

  const handleSave = async (): Promise<void> => {
    isSaving.value = true

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
      }
      await saveSettingsProject(projectConfig)
      notification.show('Настройки сохранены')
    } catch (e: unknown) {
      console.error(e)
    } finally {
      isSaving.value = false
    }
  }

  return {
    config,
    isLoaded,
    maxMemoryLimit,
    isSaving,
    selectJavaFolder,
    handleSave,
  }
}
