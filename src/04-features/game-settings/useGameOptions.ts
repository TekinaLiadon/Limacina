import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useCoreStore, useGameOptionsStore, useNotificationStore, bindSettingsDirtyTab, type GameOptions } from '@/05-entities'
import {
  getErrorMessage,
  getGameOptions,
  saveGameOptions,
  saveGlobalGameOptions,
  importGlobalGameOptions,
} from '@/06-shared/api'
import { captureProjectScope, reportError, useAsyncAction, useAsyncRaceGuard, useDirtySnapshot } from '@/06-shared'

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
  versionReady: Ref<boolean>
  availableResourcePacks: Ref<string[]>
  loadOptions: (project: string, force?: boolean) => Promise<void>
  retryLoad: () => Promise<void>
  handleImportGlobal: () => Promise<void>
  handleSave: () => Promise<void>
  handleSaveGlobal: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()
  const gameOptionsStore = useGameOptionsStore()

  const options = ref<GameOptions>(cloneDefaults())
  const isLoading = ref<boolean>(false)
  const loadError = ref<string>('')
  const isSaving = ref<boolean>(false)
  const isSavingGlobal = ref<boolean>(false)
  const hasGlobal = ref<boolean>(false)
  const versionReady = ref<boolean>(false)
  const availableResourcePacks = ref<string[]>([])
  const dirtyState = useDirtySnapshot((): GameOptions => options.value)
  let loadedProject = ''
  const loadGuard = useAsyncRaceGuard()

  const isDirty = computed<boolean>((): boolean => dirtyState.isDirty.value)

  bindSettingsDirtyTab('game', isDirty)

  const loadOptions = async (project: string, force: boolean = false): Promise<void> => {
    if (!project) return
    if (!force && loadedProject === project) return

    const generation = loadGuard.next()
    isLoading.value = true
    loadError.value = ''
    try {
      const data = await getGameOptions(project)
      if (!loadGuard.isCurrent(generation)) return
      const pending = gameOptionsStore.pendingFor(project)
      const stored = !data.versionReady && pending ? pending : data.options
      options.value = { ...cloneDefaults(), ...stored }
      versionReady.value = data.versionReady
      hasGlobal.value = data.hasGlobal
      availableResourcePacks.value = data.availableResourcePacks
      loadedProject = project
      dirtyState.captureBaseline()
    } catch (e: unknown) {
      if (!loadGuard.isCurrent(generation)) return
      options.value = cloneDefaults()
      versionReady.value = false
      hasGlobal.value = false
      availableResourcePacks.value = []
      dirtyState.captureBaseline()
      loadError.value = getErrorMessage(e)
      reportError('Не удалось загрузить настройки игры', e)
    } finally {
      if (loadGuard.isCurrent(generation)) isLoading.value = false
    }
  }

  const retryLoad = (): Promise<void> => loadOptions(coreStore.currentProject, true)

  watch(() => coreStore.currentProject, (project: string) => {
    loadGuard.cancel()
    loadedProject = ''
    isLoading.value = false
    void loadOptions(project)
  }, { immediate: true })

  onScopeDispose((): void => loadGuard.cancel())

  const handleImportGlobal = async (): Promise<void> => {
    if (isLoading.value) return
    const generation = loadGuard.next()
    try {
      const global = await importGlobalGameOptions()
      if (!loadGuard.isCurrent(generation)) return
      if (!global) {
        notification.show('Общие настройки не найдены')
        return
      }
      options.value = { ...cloneDefaults(), ...global }
      notification.show('Общие настройки подставлены, не забудьте сохранить')
    } catch (e: unknown) {
      if (!loadGuard.isCurrent(generation)) return
      reportError('Не удалось подставить общие настройки игры', e)
      notification.show(getErrorMessage(e))
    }
  }

  const saveAction = useAsyncAction((e: unknown): void => {
    reportError('Не удалось сохранить настройки игры', e)
    notification.show(getErrorMessage(e))
  }, isSaving)

  const handleSave = async (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    if (!scope.project || isLoading.value || isSaving.value || loadError.value) return

    if (!versionReady.value) {
      gameOptionsStore.setPending(scope.project, options.value)
      dirtyState.captureBaseline()
      notification.show('Настройки игры сохранены: они применятся при установке игры')
      return
    }

    await saveAction.run(async () => {
      await saveGameOptions(scope.project, options.value)
      if (!scope.isCurrent()) return
      dirtyState.captureBaseline()
      notification.show('Настройки игры сохранены')
    })
  }

  const saveGlobalAction = useAsyncAction((e: unknown): void => {
    reportError('Не удалось сохранить настройки игры как общие', e)
    notification.show(getErrorMessage(e))
  }, isSavingGlobal)

  const handleSaveGlobal = async (): Promise<void> => {
    if (isLoading.value || isSavingGlobal.value || loadError.value) return

    await saveGlobalAction.run(async () => {
      await saveGlobalGameOptions(options.value)
      hasGlobal.value = true
      notification.show('Настройки сохранены как общие')
    })
  }

  return {
    options,
    isLoading,
    loadError,
    isSaving,
    isSavingGlobal,
    isDirty,
    hasGlobal,
    versionReady,
    availableResourcePacks,
    loadOptions,
    retryLoad,
    handleImportGlobal,
    handleSave,
    handleSaveGlobal,
  }
}
