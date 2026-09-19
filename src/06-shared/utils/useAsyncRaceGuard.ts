export interface AsyncRaceGuard {
  next: () => number
  isCurrent: (generation: number) => boolean
  cancel: () => void
}

export function useAsyncRaceGuard(): AsyncRaceGuard {
  let generation = 0

  return {
    next: (): number => {
      generation += 1
      return generation
    },
    isCurrent: (value: number): boolean => value === generation,
    cancel: (): void => {
      generation += 1
    },
  }
}
