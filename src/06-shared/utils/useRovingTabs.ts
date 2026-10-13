export interface RovingTabItem<K extends string = string> {
  key: K
  isAvailable?: boolean
}

export interface RovingTabsOptions<K extends string> {
  tabs: () => RovingTabItem<K>[]
  isActive: (key: K) => boolean
  tabId: (key: K) => string
  select?: (key: K) => void
}

export function useRovingTabs<K extends string>(options: RovingTabsOptions<K>): {
  move: (delta: number) => void
  handleKeydown: (event: KeyboardEvent) => void
} {
  const move = (delta: number): void => {
    const available = options.tabs().filter((tab) => tab.isAvailable ?? true)
    if (available.length === 0) return
    const focusedId = document.activeElement?.id ?? ''
    const focusedIndex = available.findIndex((tab) => options.tabId(tab.key) === focusedId)
    const activeIndex = available.findIndex((tab) => options.isActive(tab.key))
    const anchorIndex = focusedIndex !== -1 ? focusedIndex : activeIndex
    const nextIndex = anchorIndex === -1 ? 0 : (anchorIndex + delta + available.length) % available.length
    const next = available[nextIndex]
    if (!next) return
    options.select?.(next.key)
    document.getElementById(options.tabId(next.key))?.focus({ preventScroll: true })
  }

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
    }
  }

  return { move, handleKeydown }
}
