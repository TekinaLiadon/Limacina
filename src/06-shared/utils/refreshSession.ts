import { getSessionInfo } from '@/06-shared/api'
import type { SessionInfo } from '../types'
import type { ProjectScope } from './captureProjectScope'
import { reportError } from './reportError'

export async function refreshSession(
  scope: ProjectScope,
  apply: (session: SessionInfo) => void,
  errorMessage: string,
): Promise<void> {
  try {
    const session = await getSessionInfo()
    if (!scope.isCurrent() || !session) return
    apply(session)
  } catch (e: unknown) {
    reportError(errorMessage, e)
  }
}
