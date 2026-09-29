import { computed, ref, type ComputedRef } from 'vue'

export interface DirtySnapshotState<T extends object> {
  isDirty: ComputedRef<boolean>
  hasBaseline: ComputedRef<boolean>
  captureBaseline: () => void
  isFieldDirty: (key: keyof T) => boolean
}

export function useDirtySnapshot<T extends object>(source: () => T): DirtySnapshotState<T> {
  const baseline = ref<Record<keyof T, string> | null>(null)

  const captureBaseline = (): void => {
    const data = source()
    const snapshot = {} as Record<keyof T, string>
    for (const key of Object.keys(data) as (keyof T)[]) {
      snapshot[key] = JSON.stringify(data[key])
    }
    baseline.value = snapshot
  }

  const hasBaseline = computed((): boolean => baseline.value !== null)

  const isFieldDirty = (key: keyof T): boolean => {
    const snapshot = baseline.value
    if (snapshot === null) return false
    return snapshot[key] !== JSON.stringify(source()[key])
  }

  const isDirty = computed((): boolean => {
    const snapshot = baseline.value
    if (snapshot === null) return false
    const data = source()
    return (Object.keys(data) as (keyof T)[]).some(
      (key) => snapshot[key] !== JSON.stringify(data[key]),
    )
  })

  return { isDirty, hasBaseline, captureBaseline, isFieldDirty }
}
