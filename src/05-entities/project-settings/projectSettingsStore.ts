import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ModLoaderKind, ProjectConfig } from '../core/types'
import { useDirtySnapshot } from '@/06-shared'

export type ProjectDirtyField =
  | 'loaderVersion'
  | 'javaPath'
  | 'jvmArgs'
  | 'memoryRange'
  | 'autoJoinServer'

type ProjectDirtySnapshot = Pick<ProjectSettingsForm, ProjectDirtyField>

export interface ProjectSettingsForm {
  projectName: string
  mcVersion: string
  modLoader: ModLoaderKind
  loaderVersion: string
  javaPath: string
  javaVersion: number | null
  jvmArgs: string
  memoryRange: [number, number]
  online: boolean
  initialized: boolean
  serverUrl: string | null
  autoJoinServer: boolean
}

function defaultForm(): ProjectSettingsForm {
  return {
    projectName: '',
    mcVersion: '',
    modLoader: 'vanilla',
    loaderVersion: '',
    javaPath: '',
    javaVersion: null,
    jvmArgs: '',
    memoryRange: [512, 4096],
    online: true,
    initialized: false,
    serverUrl: null,
    autoJoinServer: false,
  }
}

const DEFAULT_MIN_MEMORY = 512
const DEFAULT_MAX_MEMORY = 4096

const parseMemory = (val: string | null | undefined, fallback: number): number => {
  if (!val) return fallback
  const num = parseInt(val.replace(/[^0-9]/g, ''), 10)
  if (Number.isNaN(num)) return fallback
  const mb = val.toUpperCase().includes('G') ? num * 1024 : num
  return Number.isFinite(mb) ? mb : fallback
}

export function projectSettingsFormFromConfig(config: ProjectConfig): ProjectSettingsForm {
  return {
    projectName: config.projectName,
    mcVersion: config.mcVersion,
    modLoader: config.modLoader,
    loaderVersion: config.loaderVersion ?? '',
    javaPath: config.javaPath ?? '',
    javaVersion: config.javaVersion ?? null,
    jvmArgs: (config.jvmArgs ?? []).join(', '),
    memoryRange: [
      parseMemory(config.minMemory, DEFAULT_MIN_MEMORY),
      parseMemory(config.maxMemory, DEFAULT_MAX_MEMORY),
    ],
    online: config.online,
    initialized: config.initialized,
    serverUrl: config.serverUrl,
    autoJoinServer: config.autoJoinServer,
  }
}

function pickDirtyFields(form: ProjectSettingsForm): ProjectDirtySnapshot {
  return {
    loaderVersion: form.loaderVersion,
    javaPath: form.javaPath,
    jvmArgs: form.jvmArgs,
    memoryRange: form.memoryRange,
    autoJoinServer: form.autoJoinServer,
  }
}

export const useProjectSettingsStore = defineStore('projectSettings', () => {
  const config = ref<ProjectSettingsForm>(defaultForm())
  const isLoaded = ref<boolean>(false)
  const isSaving = ref<boolean>(false)
  const loadError = ref<string>('')
  const loadedProject = ref<string>('')
  const loadingProject = ref<string>('')

  const dirtyState = useDirtySnapshot<ProjectDirtySnapshot>(
    (): ProjectDirtySnapshot => pickDirtyFields(config.value),
  )

  const isDirty = computed<boolean>(() => isLoaded.value && dirtyState.isDirty.value)

  function captureBaseline(): void {
    dirtyState.captureBaseline()
  }

  function isFieldDirty(key: ProjectDirtyField): boolean {
    return dirtyState.isFieldDirty(key)
  }

  function startLoading(project: string): void {
    loadingProject.value = project
    config.value = defaultForm()
    loadError.value = ''
    isLoaded.value = false
    dirtyState.clearBaseline()
  }

  function applyLoaded(project: string, form: ProjectSettingsForm): void {
    if (loadingProject.value !== project) return
    adoptLoaded(project, form)
  }

  function adoptLoaded(project: string, form: ProjectSettingsForm): void {
    config.value = form
    loadedProject.value = project
    isLoaded.value = true
    loadError.value = ''
    loadingProject.value = ''
    captureBaseline()
  }

  function applyError(project: string, message: string): void {
    if (loadingProject.value !== project) return
    config.value = defaultForm()
    loadedProject.value = ''
    isLoaded.value = false
    loadError.value = message
    loadingProject.value = ''
    dirtyState.clearBaseline()
  }

  function finishLoading(project: string): void {
    if (loadingProject.value !== project) return
    loadingProject.value = ''
  }

  function startSaving(): void {
    isSaving.value = true
  }

  function finishSaving(): void {
    isSaving.value = false
  }

  return {
    config,
    isLoaded,
    isSaving,
    loadError,
    loadedProject,
    loadingProject,
    isDirty,
    captureBaseline,
    isFieldDirty,
    startLoading,
    applyLoaded,
    adoptLoaded,
    applyError,
    finishLoading,
    startSaving,
    finishSaving,
  }
})
