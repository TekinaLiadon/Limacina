import type { WritableComputedRef } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authLogins, getErrorMessage } from '@/06-shared/api'
import { captureProjectScope, reportError, storeBinding } from '@/06-shared'

export function useAccountsList(): {
  logins: WritableComputedRef<string[]>
  loadAccounts: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const store = useAccountsStore()

  const logins = storeBinding(store, 'logins')

  const loadAccounts = async (): Promise<void> => {
    const scope = captureProjectScope((): string => coreStore.currentProject)
    if (!scope.project) return

    store.isLoginsLoading = true
    store.loginsError = ''
    try {
      const loadedLogins = await authLogins(scope.project)
      if (!scope.isCurrent()) return
      store.logins = loadedLogins
    } catch (e: unknown) {
      if (!scope.isCurrent()) return
      store.loginsError = getErrorMessage(e)
      reportError('Не удалось загрузить аккаунты', e)
    } finally {
      if (scope.isCurrent()) {
        store.isLoginsLoading = false
      }
    }
  }

  return {
    logins,
    loadAccounts,
  }
}
