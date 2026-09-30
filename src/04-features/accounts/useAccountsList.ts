import type { WritableComputedRef } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authLogins, getErrorMessage } from '@/06-shared/api'
import { reportError, storeBinding } from '@/06-shared'

export function useAccountsList(): {
  logins: WritableComputedRef<string[]>
  loadAccounts: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const store = useAccountsStore()

  const logins = storeBinding(store, 'logins')

  const loadAccounts = async (): Promise<void> => {
    const projectName = coreStore.currentProject
    if (!projectName) return

    store.isLoginsLoading = true
    store.loginsError = ''
    try {
      const loadedLogins = await authLogins(projectName)
      if (coreStore.currentProject !== projectName) return
      store.logins = loadedLogins
    } catch (e: unknown) {
      if (coreStore.currentProject !== projectName) return
      store.loginsError = getErrorMessage(e)
      reportError('Не удалось загрузить аккаунты', e)
    } finally {
      if (coreStore.currentProject === projectName) {
        store.isLoginsLoading = false
      }
    }
  }

  return {
    logins,
    loadAccounts,
  }
}
