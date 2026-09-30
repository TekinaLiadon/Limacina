import { computed, type WritableComputedRef } from 'vue'

export function storeBinding<T, K extends keyof T>(store: T, field: K): WritableComputedRef<T[K]> {
  return computed({
    get: (): T[K] => store[field],
    set: (value: T[K]): void => {
      store[field] = value
    },
  })
}
