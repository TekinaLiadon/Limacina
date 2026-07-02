import { useCoreStore } from '@/05-entities'
import type { CoreState } from '@/05-entities/core/types'

export default async (): Promise<void> => {
  const coreStore = useCoreStore()
  if (!coreStore.isLoading) return
  coreStore.$patch((state: CoreState) => {
    state.isLoading = false
  })
}
