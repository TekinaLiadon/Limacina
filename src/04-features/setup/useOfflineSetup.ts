import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCoreStore } from '@/05-entities'

let isRedirectStarted = false

export function startOfflineSetupRedirect(): void {
  if (isRedirectStarted) return
  isRedirectStarted = true

  const router = useRouter()
  const route = useRoute()
  const coreStore = useCoreStore()

  watch((): boolean => coreStore.needsOfflineSetup, (needed: boolean): void => {
    if (needed && route.name !== 'Setup') {
      router.replace({ name: 'Setup' })
    }
  })
}

export function useOfflineSetup(): {
  step: Ref<1 | 2>
  needsProfile: ComputedRef<boolean>
} {
  const router = useRouter()
  const coreStore = useCoreStore()

  const step = ref<1 | 2>(1)
  const needsProfile = computed((): boolean => coreStore.needsOfflineSetup)

  watch((): boolean => coreStore.hasLauncherConfig, (hasConfig: boolean) => {
    if (!hasConfig) {
      step.value = 1
      return
    }
    if (!needsProfile.value) {
      router.replace('/')
      return
    }
    step.value = 2
  }, { immediate: true })

  return { step, needsProfile }
}
