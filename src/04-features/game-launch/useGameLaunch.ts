import { computed } from 'vue'
import { useCoreStore, useAccountsStore, LOADER_LABELS, type ProjectConfig, type StepProgressItem } from '@/05-entities'
import { getErrorMessage, initializeProject, setInitialized, clearInstallJournal, loadInstallJournal, recordInstallStep, downloadJava, downloadServerFile, downloadMinecraft, downloadServerMods, startMinecraft, exitLauncher } from '@/06-shared/api'
import { reportError, computeStepProgress, STEP_IDS, stepPlanItems, type StepPlanItem } from '@/06-shared'
import { useLaunchStepsStream } from './useLaunchStepsStream'

type StepAction = () => Promise<void>

const LAUNCH_ACTION: StepAction = startMinecraft

const JAVA_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.javaCheck,
  STEP_IDS.javaDownload,
  STEP_IDS.javaExtract,
])

const SERVER_FILES_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.filesList,
  STEP_IDS.filesDownload,
])

const MODS_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.modsList,
  STEP_IDS.modsDownload,
  STEP_IDS.modsClean,
])

const MINECRAFT_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.mcManifest,
  STEP_IDS.mcVersion,
  STEP_IDS.mcJar,
  STEP_IDS.mcLibs,
  STEP_IDS.mcNatives,
  STEP_IDS.mcAssetsIndex,
  STEP_IDS.mcAssets,
])

const LAUNCH_STEPS: StepPlanItem[] = stepPlanItems([
  STEP_IDS.launchConfig,
  STEP_IDS.launchProcess,
  STEP_IDS.launchWindow,
])

function loaderSteps(config: ProjectConfig): StepPlanItem[] {
  if (config.modLoader === 'vanilla') return []
  return [{ key: STEP_IDS.loader, label: `Установка ${LOADER_LABELS[config.modLoader]}` }]
}

interface ActionStep {
  key: string | null
  plan: StepPlanItem[]
  action: StepAction
}

function buildInstallSteps(config: ProjectConfig): ActionStep[] {
  const steps: ActionStep[] = [{ key: 'install.java', plan: JAVA_STEPS, action: downloadJava }]
  if (config.online) {
    steps.push({ key: 'install.files', plan: SERVER_FILES_STEPS, action: downloadServerFile })
    if (config.modLoader !== 'vanilla') {
      steps.push({ key: 'install.mods', plan: MODS_STEPS, action: downloadServerMods })
    }
  }
  steps.push({
    key: 'install.minecraft',
    plan: [...MINECRAFT_STEPS, ...loaderSteps(config)],
    action: downloadMinecraft,
  })
  steps.push({ key: null, plan: LAUNCH_STEPS, action: LAUNCH_ACTION })
  return steps
}

function buildLaunchPlan(config: ProjectConfig): StepPlanItem[] {
  const plan: StepPlanItem[] = []
  if (config.online) {
    plan.push(...SERVER_FILES_STEPS)
    if (config.modLoader !== 'vanilla') {
      plan.push(...MODS_STEPS)
    }
  }
  plan.push(...LAUNCH_STEPS)
  return plan
}

function buildLaunchActions(config: ProjectConfig): ActionStep[] {
  const steps: ActionStep[] = []
  if (config.online) {
    steps.push({ key: null, plan: [], action: downloadServerFile })
    if (config.modLoader !== 'vanilla') {
      steps.push({ key: null, plan: [], action: downloadServerMods })
    }
  }
  steps.push({ key: null, plan: [], action: LAUNCH_ACTION })
  return steps
}

function buildInstallFingerprint(config: ProjectConfig): string {
  return [
    'v1',
    config.mcVersion,
    config.modLoader,
    config.loaderVersion ?? '',
    config.online ? (config.serverUrl ?? '') : 'offline',
  ].join('|')
}

export function useGameLaunch() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()
  const { resetLaunchSteps, prefillLaunchSteps, flushLaunchSteps } = useLaunchStepsStream()

  const launchSteps = computed((): StepProgressItem[] => store.launchSteps)
  const activeProgress = computed((): number => store.activeProgress)

  const markActiveStepError = (message: string): void => {
    const step = store.launchSteps.find((s) => s.status === 'active')
    if (step) {
      step.status = 'error'
      step.error = message
    }
  }

  const failStep = async (error: unknown, isCancelled?: () => boolean): Promise<void> => {
    if (isCancelled?.()) return
    await flushLaunchSteps()
    markActiveStepError(getErrorMessage(error))
    store.loginError = getErrorMessage(error)
    store.isLaunching = false
  }

  const executeSteps = async (isCancelled?: () => boolean): Promise<void> => {
    let config: ProjectConfig
    try {
      config = await initializeProject(coreStore.currentProject)
    } catch (e: unknown) {
      if (isCancelled?.()) return
      store.loginError = getErrorMessage(e)
      store.isLaunching = false
      return
    }
    if (isCancelled?.()) return
    coreStore.projectConfig = config

    const isInstall = !config.initialized
    const actionSteps: ActionStep[] = isInstall
      ? buildInstallSteps(config)
      : buildLaunchActions(config)
    const plan: StepPlanItem[] = isInstall
      ? actionSteps.flatMap((step) => step.plan)
      : buildLaunchPlan(config)

    prefillLaunchSteps(plan)
    store.loginError = ''

    const fingerprint = buildInstallFingerprint(config)
    const skipKeys = new Set<string>()
    if (isInstall) {
      const journalKeys = actionSteps.flatMap((step) => (step.key !== null ? [step.key] : []))
      try {
        for (const key of await loadInstallJournal(coreStore.currentProject, fingerprint, journalKeys)) {
          skipKeys.add(key)
        }
      } catch (e: unknown) {
        reportError('Не удалось прочитать журнал установки', e)
      }
      if (skipKeys.size > 0) {
        const skippedPlanKeys = new Set<string>(
          actionSteps
            .filter((step) => step.key !== null && skipKeys.has(step.key))
            .flatMap((step) => step.plan.map((item) => item.key)),
        )
        for (const item of store.launchSteps) {
          if (skippedPlanKeys.has(item.key)) {
            item.status = 'done'
            item.skipped = true
          }
        }
        store.activeProgress = computeStepProgress(store.launchSteps)
      }
    }

    for (const step of actionSteps) {
      if (isCancelled?.()) return
      if (step.key !== null && skipKeys.has(step.key)) continue

      try {
        await step.action()
        if (step.key !== null) {
          try {
            await recordInstallStep(coreStore.currentProject, fingerprint, step.key)
          } catch (e: unknown) {
            reportError('Не удалось записать журнал установки', e)
          }
        }
      } catch (error: unknown) {
        await failStep(error, isCancelled)
        return
      }
    }

    if (isCancelled?.()) return

    if (isInstall) {
      try {
        await clearInstallJournal(coreStore.currentProject)
      } catch (e: unknown) {
        reportError('Не удалось очистить журнал установки', e)
      }
      try {
        coreStore.projectConfig = await setInitialized()
      } catch (error: unknown) {
        await failStep(error, isCancelled)
        return
      }
    }

    if (coreStore.launcherConfig?.closeAfterLaunch) {
      try {
        await exitLauncher()
      } catch (error: unknown) {
        await failStep(error, isCancelled)
        return
      }
      return
    }

    await flushLaunchSteps()
    resetLaunchSteps()
    store.isLaunching = false
  }

  return {
    launchSteps,
    activeProgress,
    executeSteps,
  }
}
