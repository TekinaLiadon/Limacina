import { computed } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { initializeProject, setInitialized, downloadJava, downloadServerFile, downloadMinecraft, downloadServerMods, startMinecraft, exitLauncher } from '@/06-shared/api'
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
  { key: 'mods.clean', label: 'Очистка лишних модов' },
  { key: 'mods.download', label: 'Проверка и скачивание модов' },
]

const MINECRAFT_STEPS: StepPlanItem[] = [
  { key: 'mc.manifest', label: 'Загрузка манифеста версий' },
  { key: 'mc.version', label: 'Загрузка манифеста версии' },
  { key: 'mc.jar', label: 'Скачивание клиента игры' },
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

function buildInstallPlan(config: ProjectConfig): StepPlanItem[] {
  const plan: StepPlanItem[] = [...JAVA_STEPS]
  if (config.online) {
    plan.push(...SERVER_FILES_STEPS)
    if (config.modLoader !== 'vanilla') {
      plan.push(...MODS_STEPS)
    }
  }
  plan.push(...MINECRAFT_STEPS, ...loaderSteps(config), ...LAUNCH_STEPS)
  return plan
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

function buildInstallActions(config: ProjectConfig): StepAction[] {
  const actions: StepAction[] = [downloadJava]
  if (config.online) {
    actions.push(downloadServerFile)
    if (config.modLoader !== 'vanilla') {
      actions.push(downloadServerMods)
    }
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
  const { resetLaunchSteps, prefillLaunchSteps } = useLaunchStepsStream()

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
      store.isLaunching = false
      return
    }
    coreStore.projectConfig = config

    const plan = config.initialized ? buildLaunchPlan(config) : buildInstallPlan(config)
    const actions = config.initialized ? buildLaunchActions(config) : buildInstallActions(config)

    prefillLaunchSteps(plan)
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
      coreStore.projectConfig = await setInitialized()
    }

    if (coreStore.launcherConfig?.closeAfterLaunch) {
      await exitLauncher()
      return
    }

    resetLaunchSteps()
    store.isLaunching = false
  }

  return {
    launchSteps,
    activeProgress,
    executeSteps,
  }
}
