import { computed } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { getErrorMessage, initializeProject, setInitialized, clearInstallJournal, loadInstallJournal, recordInstallStep, downloadJava, downloadServerFile, downloadMinecraft, downloadServerMods, startMinecraft, exitLauncher } from '@/06-shared/api'
import { reportError } from '@/06-shared'
import type { ProjectConfig, StepProgressItem } from '@/05-entities/core/types'
import { useLaunchStepsStream } from './useLaunchStepsStream'

type StepAction = () => Promise<void>

const LAUNCH_ACTION: StepAction = startMinecraft

interface StepPlanItem {
  key: string
  label: string
}

const JAVA_STEPS: StepPlanItem[] = [
  { key: 'java.check', label: 'Проверка Java' },
  { key: 'java.download', label: 'Скачивание Java' },
  { key: 'java.extract', label: 'Распаковка Java' },
]

const SERVER_FILES_STEPS: StepPlanItem[] = [
  { key: 'files.list', label: 'Получение списка файлов' },
  { key: 'files.download', label: 'Скачивание файлов' },
]

const MODS_STEPS: StepPlanItem[] = [
  { key: 'mods.list', label: 'Получение списка модов' },
  { key: 'mods.download', label: 'Проверка и скачивание модов' },
  { key: 'mods.clean', label: 'Очистка лишних модов' },
]

const MINECRAFT_STEPS: StepPlanItem[] = [
  { key: 'mc.manifest', label: 'Загрузка манифеста версий' },
  { key: 'mc.version', label: 'Загрузка манифеста версии' },
  { key: 'mc.jar', label: 'Клиент игры' },
  { key: 'mc.libs', label: 'Библиотеки игры' },
  { key: 'mc.natives', label: 'Нативные библиотеки' },
  { key: 'mc.assets.index', label: 'Загрузка индекса ресурсов' },
  { key: 'mc.assets', label: 'Загрузка ресурсов' },
]

const LOADER_STEPS: Record<string, string> = {
  fabric: 'Установка Fabric',
  forge: 'Установка Forge',
  neoforge: 'Установка NeoForge',
}

const LAUNCH_STEPS: StepPlanItem[] = [
  { key: 'launch.config', label: 'Подготовка конфигурации' },
  { key: 'launch.process', label: 'Запуск процесса игры' },
  { key: 'launch.window', label: 'Ожидание окна игры' },
]

function loaderSteps(config: ProjectConfig): StepPlanItem[] {
  const label = LOADER_STEPS[config.modLoader]
  if (label === undefined) return []
  return [{ key: 'loader', label }]
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

  const executeSteps = async (isCancelled?: () => boolean): Promise<void> => {
    let config: ProjectConfig
    try {
      config = await initializeProject(coreStore.currentProject)
    } catch (e: unknown) {
      if (isCancelled?.()) return
      coreStore.loginError = getErrorMessage(e)
      store.isLaunching = false
      return
    }
    coreStore.projectConfig = config

    const isInstall = !config.initialized
    const actionSteps: ActionStep[] = isInstall
      ? buildInstallSteps(config)
      : buildLaunchActions(config)
    const plan: StepPlanItem[] = isInstall
      ? actionSteps.flatMap((step) => step.plan)
      : buildLaunchPlan(config)

    prefillLaunchSteps(plan)
    coreStore.loginError = ''

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
        const skippedPlanKeys = new Set(
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
        if (isCancelled?.()) return
        await flushLaunchSteps()
        markActiveStepError(getErrorMessage(error))
        coreStore.loginError = getErrorMessage(error)
        store.isLaunching = false
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
      coreStore.projectConfig = await setInitialized()
    }

    if (coreStore.launcherConfig?.closeAfterLaunch) {
      await exitLauncher()
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
