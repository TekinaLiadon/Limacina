import { useCoreStore } from '@/05-entities'
import { clearSession } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export async function finalizeSession(): Promise<void> {
  const coreStore = useCoreStore()
  try {
    await clearSession()
  } catch (e: unknown) {
    reportError('Не удалось завершить сессию на стороне лаунчера', e)
  }
  coreStore.clearSessionState()
}
