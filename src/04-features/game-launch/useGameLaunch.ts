import { ref } from 'vue'
import { useCoreStore } from '@/05-entities'
import { downloadJava, downloadServerFile, downloadServerMods, startMinecraft } from '@/06-shared/api'
import type { StepProgressItem } from '@/05-entities/core/types'

const STEP_DEFS = [
  { label: 'Загрузка Java', action: downloadJava },
  { label: 'Синхронизация файлов', action: downloadServerFile },
  { label: 'Загрузка модов', action: downloadServerMods },
  { label: 'Запуск', action: startMinecraft },
] as const

export function useGameLaunch() {
  const coreStore = useCoreStore()
  const launchSteps = ref<StepProgressItem[]>([])
  const activeProgress = ref<number>(0)

  const resetSteps = (): void => {
    launchSteps.value = STEP_DEFS.map((def, i) => ({
      id: i + 1,
      label: def.label,
      status: 'pending' as const,
    }))
    activeProgress.value = 0
  }

  const runStep = async (index: number): Promise<void> => {
    if (index >= launchSteps.value.length) return
    if (index > 0) launchSteps.value[index - 1].status = 'done'

    const step = launchSteps.value[index]
    step.status = 'active'
    activeProgress.value = ((index + 1) / launchSteps.value.length) * 100

    try {
      await STEP_DEFS[index].action()
    } catch (error: unknown) {
      const message = String(error)
      step.status = 'error'
      step.error = message
      coreStore.loginError = message
      return
    }

    await runStep(index + 1)
  }

  const executeSteps = async (): Promise<void> => {
    resetSteps()
    await runStep(0)
    launchSteps.value[launchSteps.value.length - 1].status = 'done'
    activeProgress.value = 100
  }

  return {
    launchSteps,
    activeProgress,
    executeSteps,
  }
}
