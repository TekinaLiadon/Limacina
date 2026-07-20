import { computed } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { initializeProject, setInitialized, downloadJava, downloadServerFile, downloadMinecraft, downloadServerMods, startMinecraft } from '@/06-shared/api'
import type { StepProgressItem, ProjectConfig } from '@/05-entities/core/types'

interface StepDef {
  label: string
  action: () => Promise<void>
}

const LAUNCH_SUFFIX: StepDef = { label: 'Запуск', action: startMinecraft }

function buildInstallSteps(): StepDef[] {
  const steps: StepDef[] = [
    { label: 'Установка Java', action: downloadJava },
    { label: 'Синхронизация файлов', action: downloadServerFile },
    { label: 'Установка Minecraft', action: downloadMinecraft },
  ]
  steps.push(LAUNCH_SUFFIX)
  return steps
}

function buildLaunchSteps(config: ProjectConfig): StepDef[] {
  const steps: StepDef[] = [
    { label: 'Синхронизация файлов', action: downloadServerFile },
  ]
  if (config.modLoader !== 'vanilla') {
    steps.push({ label: 'Проверка модов', action: downloadServerMods })
  }
  steps.push(LAUNCH_SUFFIX)
  return steps
}

function resetSteps(defs: StepDef[]): StepProgressItem[] {
  return defs.map((def, i) => ({
    id: i + 1,
    label: def.label,
    status: 'pending' as const,
  }))
}

export function useGameLaunch() {
  const coreStore = useCoreStore()
  const store = useAccountsStore()

  const launchSteps = computed({
    get: (): StepProgressItem[] => store.launchSteps,
    set: (v: StepProgressItem[]): void => { store.launchSteps = v },
  })
  const activeProgress = computed({
    get: (): number => store.activeProgress,
    set: (v: number): void => { store.activeProgress = v },
  })

  const executeSteps = async (isCancelled?: () => boolean): Promise<void> => {
    const config = await initializeProject(coreStore.currentProject)

    const stepDefs = config.initialized ? buildLaunchSteps(config) : buildInstallSteps()

    launchSteps.value = resetSteps(stepDefs)
    activeProgress.value = 0
    coreStore.loginError = ''

    for (let i = 0; i < stepDefs.length; i++) {
      if (isCancelled?.()) return

      if (i > 0) launchSteps.value[i - 1].status = 'done'

      const step = launchSteps.value[i]
      step.status = 'active'
      activeProgress.value = ((i + 1) / stepDefs.length) * 100

      try {
        await stepDefs[i].action()
      } catch (error: unknown) {
        if (isCancelled?.()) return
        step.status = 'error'
        coreStore.loginError = String(error)
        return
      }
    }

    if (isCancelled?.()) return

    const last = launchSteps.value[launchSteps.value.length - 1]
    last.status = 'done'
    activeProgress.value = 100

    if (!config.initialized) {
      await setInitialized()
    }
  }

  return {
    launchSteps,
    activeProgress,
    executeSteps,
  }
}
