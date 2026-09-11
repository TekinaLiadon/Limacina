import { ref, computed, watch, type Ref } from 'vue'
import type { CPMAnimation, CPMData } from '@/05-entities/core/types'
import type { DropdownOption } from '@/06-shared/types'

const SPEED_MIN = 0.25
const SPEED_MAX = 3
const SPEED_STEP = 0.25

const roundSpeed = (value: number): number => Math.round(value * 100) / 100

export function useCpmAnimations(cpmData: Ref<CPMData | null>) {
  const availableAnimations = computed((): CPMAnimation[] =>
    (cpmData.value?.animations ?? []).filter((animation) => !animation.hidden),
  )

  const animationOptions = computed((): DropdownOption[] =>
    availableAnimations.value.map((animation) => ({
      title: animation.name,
      value: animation.id,
    })),
  )

  const selectedAnimationIds = ref<string[]>([])
  const isAnimationPlaying = ref<boolean>(false)
  const isAnimationLooped = ref<boolean>(false)
  const animationSpeed = ref<number>(1)

  const activeAnimations = computed((): CPMAnimation[] =>
    selectedAnimationIds.value
      .map((id) => availableAnimations.value.find((animation) => animation.id === id))
      .filter((animation): animation is CPMAnimation => animation !== undefined),
  )

  const canSpeedDown = computed((): boolean => animationSpeed.value > SPEED_MIN)
  const canSpeedUp = computed((): boolean => animationSpeed.value < SPEED_MAX)

  watch(availableAnimations, () => {
    const existing = new Set(availableAnimations.value.map((animation) => animation.id))
    const filtered = selectedAnimationIds.value.filter((id) => existing.has(id))
    if (filtered.length !== selectedAnimationIds.value.length) {
      selectedAnimationIds.value = filtered
    }
  })

  watch(cpmData, () => {
    selectedAnimationIds.value = []
    isAnimationPlaying.value = false
    isAnimationLooped.value = false
    animationSpeed.value = 1
  })

  const toggleAnimationPlayback = (): void => {
    if (activeAnimations.value.length === 0) return
    isAnimationPlaying.value = !isAnimationPlaying.value
  }

  const toggleAnimationLoop = (): void => {
    isAnimationLooped.value = !isAnimationLooped.value
  }

  const speedDown = (): void => {
    animationSpeed.value = Math.max(SPEED_MIN, roundSpeed(animationSpeed.value - SPEED_STEP))
  }

  const speedUp = (): void => {
    animationSpeed.value = Math.min(SPEED_MAX, roundSpeed(animationSpeed.value + SPEED_STEP))
  }

  return {
    animationOptions,
    selectedAnimationIds,
    activeAnimations,
    isAnimationPlaying,
    isAnimationLooped,
    animationSpeed,
    canSpeedDown,
    canSpeedUp,
    toggleAnimationPlayback,
    toggleAnimationLoop,
    speedDown,
    speedUp,
  }
}
