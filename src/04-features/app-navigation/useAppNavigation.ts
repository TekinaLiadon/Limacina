import { computed, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCoreStore } from '@/05-entities'

export function useAppNavigation(): { isDebugTabVisible: ComputedRef<boolean> } {
  const router = useRouter()
  const route = useRoute()
  const coreStore = useCoreStore()

  const isDebugTabVisible = computed((): boolean => coreStore.launcherConfig?.debugMode ?? false)

  watch((): boolean => coreStore.isOfflineProject, (offline) => {
    if (!offline && route.name === 'Mods') {
      router.push({ name: 'Accounts' })
    }
  }, { immediate: true })

  watch((): boolean => coreStore.needsOfflineSetup, (needed: boolean): void => {
    if (needed && route.name !== 'Setup') {
      router.replace({ name: 'Setup' })
    }
  })

  watch(isDebugTabVisible, (visible: boolean): void => {
    if (!visible && route.name === 'Debug') {
      router.push({ name: 'Accounts' })
    }
  }, { immediate: true })

  return { isDebugTabVisible }
}
