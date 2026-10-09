import { ref, computed, watch, type Ref } from 'vue'
import type { CPMAnimation, CPMData } from '@/05-entities'
import type { DropdownOption } from '@/06-shared'
import { SPEED_MAX, SPEED_MIN, type ActiveCpmAnimation } from '../cpm-viewer/cpmAnimationPlayer'

const SPEED_STEP = 0.25
const SERVICE_LINK_PREFIX = 'g:'

const roundSpeed = (value: number): number => Math.round(value * 100) / 100

interface GestureComposition {
  setup: CPMAnimation | null
  finish: CPMAnimation | null
}

const serviceTargetName = (animation: CPMAnimation): string | null => {
  if (animation.kind !== 'setup' && animation.kind !== 'finish') return null
  return animation.name.startsWith(SERVICE_LINK_PREFIX)
    ? animation.name.slice(SERVICE_LINK_PREFIX.length)
    : null
}

export function useCpmAnimations(cpmData: Ref<CPMData | null>) {
  const availableAnimations = computed((): CPMAnimation[] =>
    (cpmData.value?.animations ?? []).filter((animation) => !animation.hidden),
  )

  const compositions = computed((): Map<string, GestureComposition> => {
    const mains = new Map<string, CPMAnimation>()
    for (const animation of availableAnimations.value) {
      if (serviceTargetName(animation) === null) mains.set(animation.name, animation)
    }

    const links = new Map<string, GestureComposition>()
    for (const animation of availableAnimations.value) {
      const target = serviceTargetName(animation)
      if (target === null) continue
      const main = mains.get(target)
      if (!main) continue
      const composition = links.get(main.id) ?? { setup: null, finish: null }
      if (animation.kind === 'setup') composition.setup ??= animation
      else composition.finish ??= animation
      links.set(main.id, composition)
    }
    return links
  })

  const linkedServiceIds = computed((): Set<string> => {
    const ids = new Set<string>()
    for (const { setup, finish } of compositions.value.values()) {
      if (setup) ids.add(setup.id)
      if (finish) ids.add(finish.id)
    }
    return ids
  })

  const animationOptions = computed((): DropdownOption[] =>
    availableAnimations.value
      .filter((animation) => !linkedServiceIds.value.has(animation.id))
      .map((animation) => ({
        title: animation.name,
        value: animation.id,
      })),
  )

  const selectedAnimationIds = ref<string[]>([])
  const isAnimationPlaying = ref<boolean>(false)
  const isAnimationLooped = ref<boolean>(false)
  const animationSpeed = ref<number>(1)

  const activeAnimations = computed((): ActiveCpmAnimation[] => {
    const result: ActiveCpmAnimation[] = []
    for (const id of selectedAnimationIds.value) {
      const animation = availableAnimations.value.find((item) => item.id === id)
      if (!animation) continue

      const composition = compositions.value.get(animation.id)
      if (!composition) {
        result.push({ animation, startDelayMs: 0 })
        continue
      }

      let offset = 0
      if (composition.setup) {
        result.push({ animation: composition.setup, startDelayMs: offset })
        offset += Math.max(composition.setup.duration, 1)
      }
      result.push({ animation, startDelayMs: offset })
      if (composition.finish && !animation.loop) {
        offset += Math.max(animation.duration, 1)
        result.push({ animation: composition.finish, startDelayMs: offset })
      }
    }
    return result
  })

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
