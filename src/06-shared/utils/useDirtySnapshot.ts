import { computed, ref, type ComputedRef } from 'vue'

type DirtyBaseline<T extends object> = Record<keyof T, string>

function captureDirtyBaseline<T extends object>(data: T): DirtyBaseline<T> {
  const snapshot = {} as DirtyBaseline<T>
  for (const key of Object.keys(data) as (keyof T)[]) {
    snapshot[key] = JSON.stringify(data[key])
  }
  return snapshot
}

function hasDirtyFields<T extends object>(baseline: DirtyBaseline<T>, data: T): boolean {
  return (Object.keys(data) as (keyof T)[]).some(
    (key) => baseline[key] !== JSON.stringify(data[key]),
  )
}

function isFieldDirtyAgainst<T extends object>(
  baseline: DirtyBaseline<T>,
  data: T,
  key: keyof T,
): boolean {
  return baseline[key] !== JSON.stringify(data[key])
}

interface DirtySnapshotState<T extends object> {
  isDirty: ComputedRef<boolean>
  hasBaseline: ComputedRef<boolean>
  captureBaseline: () => void
  patchBaseline: (partial: Partial<T>) => void
  clearBaseline: () => void
  isFieldDirty: (key: keyof T) => boolean
}

export function useDirtySnapshot<T extends object>(source: () => T): DirtySnapshotState<T> {
  const baseline = ref<DirtyBaseline<T> | null>(null)

  const captureBaseline = (): void => {
    baseline.value = captureDirtyBaseline(source())
  }

  const patchBaseline = (partial: Partial<T>): void => {
    const snapshot = baseline.value
    if (snapshot === null) {
      captureBaseline()
      return
    }
    for (const key of Object.keys(partial) as (keyof T)[]) {
      const value = partial[key]
      if (value !== undefined) snapshot[key] = JSON.stringify(value)
    }
  }

  const clearBaseline = (): void => {
    baseline.value = null
  }

  const hasBaseline = computed((): boolean => baseline.value !== null)

  const isFieldDirty = (key: keyof T): boolean => {
    const snapshot = baseline.value
    if (snapshot === null) return false
    return isFieldDirtyAgainst(snapshot, source(), key)
  }

  const isDirty = computed((): boolean => {
    const snapshot = baseline.value
    if (snapshot === null) return false
    return hasDirtyFields(snapshot, source())
  })

  return { isDirty, hasBaseline, captureBaseline, patchBaseline, clearBaseline, isFieldDirty }
}
