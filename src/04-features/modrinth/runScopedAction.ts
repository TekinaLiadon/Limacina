import type { Ref } from 'vue'
import { getErrorMessage } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export interface ScopedActionOptions<T, R> {
  isCurrent: () => boolean
  errorTarget: Ref<string>
  errorMessage: string
  run: () => Promise<T>
  apply?: (result: T) => Promise<R> | R
  busyFlag?: Ref<boolean>
  cleanup?: () => void
}

export async function runScopedAction<T, R = void>(options: ScopedActionOptions<T, R>): Promise<R | undefined> {
  if (options.busyFlag) options.busyFlag.value = true
  options.errorTarget.value = ''
  try {
    const result = await options.run()
    if (!options.isCurrent()) return undefined
    return await options.apply?.(result)
  } catch (e: unknown) {
    if (options.isCurrent()) {
      reportError(options.errorMessage, e)
      options.errorTarget.value = getErrorMessage(e)
    }
    return undefined
  } finally {
    if (options.busyFlag && options.isCurrent()) options.busyFlag.value = false
    options.cleanup?.()
  }
}
