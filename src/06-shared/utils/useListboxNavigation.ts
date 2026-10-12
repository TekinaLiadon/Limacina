import { nextTick, ref, type Ref } from 'vue'

export function useListboxNavigation(
  count: () => number,
  panelRef: Ref<HTMLElement | null>,
  confirm: (index: number) => void,
): {
  activeIndex: Ref<number>
  resetActive: (index?: number) => void
  moveActive: (delta: number) => void
  confirmActive: () => void
  scrollActiveIntoView: () => void
  navigationActions: Record<string, () => void>
} {
  const activeIndex = ref(0)

  const scrollActiveIntoView = (): void => {
    const option = panelRef.value?.children[activeIndex.value]
    if (option instanceof HTMLElement) option.scrollIntoView({ block: 'nearest' })
  }

  const resetActive = (index: number = 0): void => {
    activeIndex.value = index
    void nextTick(scrollActiveIntoView)
  }

  const moveActive = (delta: number): void => {
    const size = count()
    if (size === 0) return
    activeIndex.value = (activeIndex.value + delta + size) % size
    void nextTick(scrollActiveIntoView)
  }

  const confirmActive = (): void => {
    if (count() === 0) return
    confirm(activeIndex.value)
  }

  const navigationActions: Record<string, () => void> = {
    ArrowDown: (): void => moveActive(1),
    ArrowUp: (): void => moveActive(-1),
    Enter: confirmActive,
  }

  return { activeIndex, resetActive, moveActive, confirmActive, scrollActiveIntoView, navigationActions }
}
