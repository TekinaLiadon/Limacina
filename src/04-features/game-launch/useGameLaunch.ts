import { computed } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { initializeProject, setInitialized, downloadJava, downloadServerFile, downloadMinecraft, downloadServerMods, startMinecraft } from '@/06-shared/api'
import type { ProjectConfig, StepProgressItem } from '@/05-entities/core/types'
import { useLaunchStepsStream } from './useLaunchStepsStream'

type StepAction = () => Promise<void>

const LAUNCH_ACTION: StepAction = startMinecraft

function buildInstallActions(config: ProjectConfig): StepAction[] {
  const actions: StepAction[] = [downloadJava]
  if (config.online) {
    actions.push(downloadServerFile)
  }
  actions.push(downloadMinecraft, LAUNCH_ACTION)
  return actions
}

function buildLaunchActions(config: ProjectConfig): StepAction[] {
  const actions: StepAction[] = []
  if (config.online) {
    actions.push(downloadServerFile)
    if (config.modLoader !== 'vanilla') {
      actions.push(downloadServerMods)
    }
  }
  actions.push(LAUNCH_ACTION)
  return actions
}

export function useGameLaunch() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()
  const { resetLaunchSteps } = useLaunchStepsStream()

  const launchSteps = computed((): StepProgressItem[] => store.launchSteps)
  const activeProgress = computed((): number => store.activeProgress)

  const markActiveStepError = (message: string): void => {
    const step = store.launchSteps.find((s) => s.status === 'active')
    if (step) {
      step.status = 'error'
      step.error = message
    }
  }

  const executeSteps = async (isCancelled?: () => boolean): Promise<void> => {
    let config: ProjectConfig
    try {
      config = await initializeProject(coreStore.currentProject)
    } catch (e: unknown) {
      if (isCancelled?.()) return
      coreStore.loginError = String(e)
      return
    }
    coreStore.projectConfig = config

    const actions = config.initialized ? buildLaunchActions(config) : buildInstallActions(config)

    resetLaunchSteps()
    coreStore.loginError = ''

    for (const action of actions) {
      if (isCancelled?.()) return

      try {
        await action()
      } catch (error: unknown) {
        if (isCancelled?.()) return
        markActiveStepError(String(error))
        coreStore.loginError = String(error)
        return
      }
    }

    if (isCancelled?.()) return

    if (!config.initialized) {
      await setInitialized()
    }

    store.isLaunching = false
  }

  return {
    launchSteps,
    activeProgress,
    executeSteps,
  }
}
