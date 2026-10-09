import { ref, type Ref } from 'vue'

export interface AsyncAction {
  isLoading: Ref<boolean>
  run: (action: () => Promise<void>) => Promise<void>
}

export function useAsyncAction(
  onError: (error: unknown) => void | Promise<void>,
  isLoading?: Ref<boolean>,
): AsyncAction {
  const loading = isLoading ?? ref<boolean>(false)

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (loading.value) return
    loading.value = true
    try {
      await action()
    } catch (e: unknown) {
      await onError(e)
    } finally {
      loading.value = false
    }
  }

  return { isLoading: loading, run }
}
