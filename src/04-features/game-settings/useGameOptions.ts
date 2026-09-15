import { ref, watch, type Ref } from 'vue'
import { useCoreStore, useNotificationStore, type GameOptions } from '@/05-entities'
import {
  getGameOptions,
  saveGameOptions,
  saveGlobalGameOptions,
  importGlobalGameOptions,
} from '@/06-shared/api'
import { reportError } from '@/06-shared'

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
  isSaving: Ref<boolean>
  isSavingGlobal: Ref<boolean>
  hasGlobal: Ref<boolean>
  fileExists: Ref<boolean>
  availableResourcePacks: Ref<string[]>
  loadOptions: (project: string, force?: boolean) => Promise<void>
  handleImportGlobal: () => Promise<void>
  handleSave: () => Promise<void>
  handleSaveGlobal: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const notification = useNotificationStore()

  const options = ref<GameOptions>(cloneDefaults())
  const isLoading = ref<boolean>(false)
  const isSaving = ref<boolean>(false)
  const isSavingGlobal = ref<boolean>(false)
  const hasGlobal = ref<boolean>(false)
  const fileExists = ref<boolean>(false)
  const availableResourcePacks = ref<string[]>([])
  let loadedProject = ''

  const loadOptions = async (project: string, force: boolean = false): Promise<void> => {
    if (!project) return
    if (!force && loadedProject === project) return

    isLoading.value = true
    try {
      const data = await getGameOptions(project)
      options.value = { ...cloneDefaults(), ...data.options }
      hasGlobal.value = data.hasGlobal
      fileExists.value = data.fileExists
      availableResourcePacks.value = data.availableResourcePacks
      loadedProject = project
    } catch (e: unknown) {
      reportError('Не удалось загрузить настройки игры', e)
    } finally {
      isLoading.value = false
    }
  }

  watch(() => coreStore.currentProject, (project: string) => {
    loadedProject = ''
    loadOptions(project)
  }, { immediate: true })

  const handleImportGlobal = async (): Promise<void> => {
    try {
      const global = await importGlobalGameOptions()
      if (!global) {
        notification.show('Общие настройки не найдены')
        return
      }
      options.value = { ...cloneDefaults(), ...global }
      notification.show('Общие настройки подставлены, не забудьте сохранить')
    } catch (e: unknown) {
      notification.show(String(e))
    }
  }

  const handleSave = async (): Promise<void> => {
    const project = coreStore.currentProject
    if (!project || isSaving.value) return

    isSaving.value = true
    try {
      await saveGameOptions(project, options.value)
      fileExists.value = true
      notification.show('Настройки игры сохранены')
    } catch (e: unknown) {
      notification.show(String(e))
    } finally {
      isSaving.value = false
    }
  }

  const handleSaveGlobal = async (): Promise<void> => {
    if (isSavingGlobal.value) return

    isSavingGlobal.value = true
    try {
      await saveGlobalGameOptions(options.value)
      hasGlobal.value = true
      notification.show('Настройки сохранены как общие')
    } catch (e: unknown) {
      notification.show(String(e))
    } finally {
      isSavingGlobal.value = false
    }
  }

  return {
    options,
    isLoading,
    isSaving,
    isSavingGlobal,
    hasGlobal,
    fileExists,
    availableResourcePacks,
    loadOptions,
    handleImportGlobal,
    handleSave,
    handleSaveGlobal,
  }
}
