import { computed, onScopeDispose, ref, watch, watchEffect, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, useSettingsDirtyStore, type GameOptions } from '@/05-entities'
import {
  getErrorMessage,
  getGameOptions,
  saveGameOptions,
  saveGlobalGameOptions,
  importGlobalGameOptions,
} from '@/06-shared/api'
import { reportError, useDirtySnapshot } from '@/06-shared'

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  fov: 70,
  gamma: 0.5,
  renderDistance: 12,
  simulationDistance: 12,
  maxFps: 120,
  enableVsync: true,
  graphicsMode: 1,
  mipmapLevels: 4,
  particles: 0,
  entityShadows: true,
  ao: true,
  renderClouds: 'true',
  fullscreen: false,
  guiScale: 0,
  soundMaster: 1,
  soundMusic: 1,
  soundRecord: 1,
  soundWeather: 1,
  soundBlock: 1,
  soundHostile: 1,
  soundNeutral: 1,
  soundPlayer: 1,
  soundAmbient: 1,
  soundVoice: 1,
  chatScale: 1,
  chatWidth: 1,
  chatOpacity: 1,
  chatLineSpacing: 0,
  chatDelay: 0,
  textBackgroundOpacity: 0.5,
  chatVisibility: 'full',
  chatColors: true,
  chatLinks: true,
  chatLinksPrompt: true,
  resourcePacks: [],
}

const cloneDefaults = (): GameOptions => ({ ...DEFAULT_GAME_OPTIONS, resourcePacks: [] })

export function useGameOptions(): {
  options: Ref<GameOptions>
  isLoading: Ref<boolean>
  loadError: Ref<string>
  isSaving: Ref<boolean>
  isSavingGlobal: Ref<boolean>
  isDirty: ComputedRef<boolean>
  hasGlobal: Ref<boolean>
  availableResourcePacks: Ref<string[]>
  loadOptions: (project: string, force?: boolean) => Promise<void>
  retryLoad: () => Promise<void>
  handleImportGlobal: () => Promise<void>
  handleSave: () => Promise<void>
  handleSaveGlobal: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const options = ref<GameOptions>(cloneDefaults())
  const isLoading = ref<boolean>(false)
  const loadError = ref<string>('')
  const isSaving = ref<boolean>(false)
  const isSavingGlobal = ref<boolean>(false)
  const hasGlobal = ref<boolean>(false)
  const availableResourcePacks = ref<string[]>([])
  const dirtyState = useDirtySnapshot((): GameOptions => options.value)
  let loadedProject = ''
  let loadGeneration = 0

  const isDirty = computed<boolean>((): boolean => dirtyState.isDirty.value)

  const settingsDirtyStore = useSettingsDirtyStore()
  watchEffect((): void => {
    settingsDirtyStore.setTabDirty('game', isDirty.value)
  })
  onScopeDispose((): void => {
    settingsDirtyStore.setTabDirty('game', false)
  })

  const loadOptions = async (project: string, force: boolean = false): Promise<void> => {
    if (!project) return
    if (!force && loadedProject === project) return

    const generation = ++loadGeneration
    isLoading.value = true
    loadError.value = ''
    try {
      const data = await getGameOptions(project)
      if (generation !== loadGeneration) return
      options.value = { ...cloneDefaults(), ...data.options }
      hasGlobal.value = data.hasGlobal
      availableResourcePacks.value = data.availableResourcePacks
      loadedProject = project
      dirtyState.captureBaseline()
    } catch (e: unknown) {
      if (generation !== loadGeneration) return
      options.value = cloneDefaults()
      hasGlobal.value = false
      availableResourcePacks.value = []
      dirtyState.captureBaseline()
      loadError.value = getErrorMessage(e)
      reportError('Не удалось загрузить настройки игры', e)
    } finally {
      if (generation === loadGeneration) isLoading.value = false
    }
  }

  const retryLoad = (): Promise<void> => loadOptions(coreStore.currentProject, true)

  watch(() => coreStore.currentProject, (project: string) => {
    loadedProject = ''
    loadOptions(project)
  }, { immediate: true })

  const handleImportGlobal = async (): Promise<void> => {
    if (isLoading.value) return
    const generation = ++loadGeneration
    try {
      const global = await importGlobalGameOptions()
      if (generation !== loadGeneration) return
      if (!global) {
        notification.show('Общие настройки не найдены')
        return
      }
      options.value = { ...cloneDefaults(), ...global }
      notification.show('Общие настройки подставлены, не забудьте сохранить')
    } catch (e: unknown) {
      if (generation !== loadGeneration) return
      notification.show(getErrorMessage(e))
    }
  }

  const handleSave = async (): Promise<void> => {
    const project = coreStore.currentProject
    if (!project || isLoading.value || isSaving.value || loadError.value) return

    isSaving.value = true
    try {
      await saveGameOptions(project, options.value)
      if (coreStore.currentProject !== project) return
      dirtyState.captureBaseline()
      notification.show('Настройки игры сохранены')
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isSaving.value = false
    }
  }

  const handleSaveGlobal = async (): Promise<void> => {
    if (isLoading.value || isSavingGlobal.value || loadError.value) return

    isSavingGlobal.value = true
    try {
      await saveGlobalGameOptions(options.value)
      hasGlobal.value = true
      notification.show('Настройки сохранены как общие')
    } catch (e: unknown) {
      notification.show(getErrorMessage(e))
    } finally {
      isSavingGlobal.value = false
    }
  }

  return {
    options,
    isLoading,
    loadError,
    isSaving,
    isSavingGlobal,
    isDirty,
    hasGlobal,
    availableResourcePacks,
    loadOptions,
    retryLoad,
    handleImportGlobal,
    handleSave,
    handleSaveGlobal,
  }
}
