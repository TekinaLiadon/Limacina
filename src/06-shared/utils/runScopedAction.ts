import type { Ref } from 'vue'
import { getErrorMessage } from '@/06-shared/api'
import type { AsyncRaceGuard } from './useAsyncRaceGuard'
import type { ProjectScope } from './captureProjectScope'
import { reportError } from './reportError'

export interface ScopedActionOptions<T, R> {
  guard?: AsyncRaceGuard
  scope?: ProjectScope
  isCurrent?: () => boolean
  errorTarget?: Ref<string>
  errorMessage: string
  run: () => Promise<T>
  apply?: (result: T) => Promise<R> | R
  onError?: (error: unknown) => void | Promise<void>
  busyFlag?: Ref<boolean>
  cleanup?: () => void
}

export async function runScopedAction<T, R = void>(
  options: ScopedActionOptions<T, R>,
): Promise<R | undefined> {
  const generation = options.guard?.next()
  const isCurrent = (): boolean => {
    if (options.guard && generation !== undefined && !options.guard.isCurrent(generation)) return false
    if (options.scope && !options.scope.isCurrent()) return false
    return options.isCurrent?.() ?? true
  }

  if (options.busyFlag) options.busyFlag.value = true
  if (options.errorTarget) options.errorTarget.value = ''
  try {
    const result = await options.run()
    if (!isCurrent()) return undefined
    return await options.apply?.(result)
  } catch (e: unknown) {
    if (isCurrent()) {
      reportError(options.errorMessage, e)
      await options.onError?.(e)
      if (options.errorTarget) options.errorTarget.value = getErrorMessage(e)
    }
    return undefined
  } finally {
    if (options.busyFlag && isCurrent()) options.busyFlag.value = false
    options.cleanup?.()
  }
}
