import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LauncherConfig, ProjectConfig } from './types/index'

export const useCoreStore = defineStore('core', () => {
  const isLoading = ref<boolean>(true)
  const launcherName = ref<string>('')
  const defaultParentPath = ref<string>('')
  const launcherConfig = ref<LauncherConfig | null>(null)
  const version = ref<string>('')
  const offlineBuild = ref<boolean>(false)
  const envProjectName = ref<string>('')
  const currentProject = ref<string>('')
  const projects = ref<string[]>([])
  const totalMemoryMb = ref<number>(0)
  const projectConfig = ref<ProjectConfig | null>(null)
  const pendingCpmProjectPath = ref<string | null>(null)

  const needsOfflineSetup = computed<boolean>(
    () => offlineBuild.value && projects.value.length === 0,
  )
  const hasLauncherConfig = computed<boolean>(() => launcherConfig.value !== null)
  const isOfflineProject = computed<boolean>(() => projectConfig.value?.online === false)
  const isOnlineProject = computed<boolean>(
    () => !offlineBuild.value && projectConfig.value?.online === true,
  )

  function applyLauncherConfig(config: LauncherConfig): void {
    launcherConfig.value = config
    applyLauncherProjects(config)
  }

  function applyLauncherProjects(config: LauncherConfig): void {
    projects.value = [...config.projectNames]
    const [first] = projects.value
    if (first === undefined) {
      currentProject.value = ''
      return
    }

    const saved = config.currentProject
    currentProject.value = saved !== null && projects.value.includes(saved) ? saved : first
  }

  return {
    isLoading,
    launcherName,
    defaultParentPath,
    launcherConfig,
    version,
    offlineBuild,
    envProjectName,
    currentProject,
    projects,
    totalMemoryMb,
    projectConfig,
    pendingCpmProjectPath,
    needsOfflineSetup,
    hasLauncherConfig,
    isOfflineProject,
    isOnlineProject,
    applyLauncherConfig,
    applyLauncherProjects,
  }
})
