import { useCoreStore, useNotificationStore, useOptionalModsStore, type StepEvent } from '@/05-entities'
import { fetchOptionalMods, listenLaunchSteps } from '@/06-shared/api'
import { createSingletonListeners, OPTIONAL_SYNC_STEP_IDS, reportError } from '@/06-shared'

const OPTIONAL_LIST_ERROR = 'Не удалось получить список необязательных модов'
const OPTIONAL_SYNC_WARNING = 'Не удалось синхронизировать необязательные моды'
const SYNC_WARNING_LISTENERS_ERROR = 'Не удалось запустить поток предупреждений о синхронизации необязательных модов'

const syncWarningListeners = createSingletonListeners()

export function useOptionalMods(): {
  loadList: () => Promise<void>
  startSyncWarnings: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const optionalModsStore = useOptionalModsStore()
  const notification = useNotificationStore()

  const isListAvailable = (): boolean => {
    const { projectConfig } = coreStore
    return coreStore.isServerBuild && projectConfig?.online === true && projectConfig.modLoader !== 'vanilla'
  }

  const loadList = async (): Promise<void> => {
    try {
      if (!isListAvailable()) {
        optionalModsStore.reset()
        return
      }
      optionalModsStore.setList(await fetchOptionalMods())
    } catch (e: unknown) {
      reportError(OPTIONAL_LIST_ERROR, e)
    }
  }

  const handleStepEvent = (event: StepEvent): void => {
    if (event.type !== 'failed' || !OPTIONAL_SYNC_STEP_IDS.has(event.id)) return
    notification.show(OPTIONAL_SYNC_WARNING)
  }

  const startSyncWarnings = async (): Promise<void> => {
    if (syncWarningListeners.isStarted()) return
    try {
      await syncWarningListeners.start(async (track): Promise<void> => {
        track(await listenLaunchSteps(handleStepEvent))
      })
    } catch (e: unknown) {
      reportError(SYNC_WARNING_LISTENERS_ERROR, e)
    }
  }

  return {
    loadList,
    startSyncWarnings,
  }
}
