import { computed, type WritableComputedRef } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authLogins, getErrorMessage } from '@/06-shared/api'
import { reportError } from '@/06-shared'

export function useAccountsList(): {
  logins: WritableComputedRef<string[]>
  loadAccounts: () => Promise<void>
} {
  const coreStore = useCoreStore()
  const store = useAccountsStore()

  const logins = computed({
    get: (): string[] => store.logins,
    set: (v: string[]): void => { store.logins = v },
  })

  const loadAccounts = async (): Promise<void> => {
    const projectName = coreStore.currentProject
    if (!projectName) return

    store.isLoginsLoading = true
    store.loginsError = ''
    try {
      store.logins = await authLogins(projectName)
    } catch (e: unknown) {
      store.loginsError = getErrorMessage(e)
      reportError('Не удалось загрузить аккаунты', e)
    } finally {
      store.isLoginsLoading = false
    }
  }

  return {
    logins,
    loadAccounts,
  }
}
