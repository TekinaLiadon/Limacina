import { computed, type WritableComputedRef } from 'vue'
import { useCoreStore, useAccountsStore } from '@/05-entities'
import { authLogins } from '@/06-shared/api'
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
    try {
      store.logins = await authLogins(coreStore.currentProject)
    } catch (e: unknown) {
      reportError('Не удалось загрузить аккаунты', e)
    }
  }

  return {
    logins,
    loadAccounts,
  }
}
