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
  const isServerBuild = computed<boolean>(() => !offlineBuild.value)
  const isOfflineProject = computed<boolean>(() => projectConfig.value?.online === false)
  const isOnlineProject = computed<boolean>(() => projectConfig.value?.online === true)

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

  function setLauncherConfig(config: LauncherConfig | null): void {
    launcherConfig.value = config
    if (config === null) {
      projects.value = []
      currentProject.value = ''
      return
    }

    applyLauncherProjects(config)
  }

  function applySavedLauncherConfig(config: LauncherConfig): void {
    if (launcherConfig.value === null) {
      setLauncherConfig(config)
      return
    }

    launcherConfig.value = {
      ...config,
      projectNames: [...projects.value],
      currentProject: currentProject.value || null,
    }
  }

  function applyProjectSwitch(projectName: string, config: ProjectConfig | null): void {
    currentProject.value = projectName
    projectConfig.value = config
    if (launcherConfig.value === null) return

    launcherConfig.value = { ...launcherConfig.value, currentProject: projectName }
  }

  function addProject(projectName: string, config: ProjectConfig): void {
    if (!projects.value.includes(projectName)) {
      projects.value = [...projects.value, projectName]
    }
    if (launcherConfig.value !== null) {
      launcherConfig.value = {
        ...launcherConfig.value,
        projectNames: [...projects.value],
        currentProject: projectName,
      }
    }
    currentProject.value = projectName
    projectConfig.value = config
  }

  function setProjectConfig(config: ProjectConfig | null): void {
    projectConfig.value = config
  }

  function setPendingCpmProjectPath(path: string | null): void {
    pendingCpmProjectPath.value = path
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
    isServerBuild,
    isOfflineProject,
    isOnlineProject,
    setLauncherConfig,
    applySavedLauncherConfig,
    applyProjectSwitch,
    addProject,
    setProjectConfig,
    setPendingCpmProjectPath,
  }
})
