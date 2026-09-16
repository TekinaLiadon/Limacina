import { computed, nextTick, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'

export function useDropdownPanel(
  rootRef: Ref<HTMLDivElement | null>,
  isDisabled: () => boolean,
  maxVisible: () => number,
): {
  shown: Ref<boolean>
  openUp: Ref<boolean>
  maxHeight: ComputedRef<string>
  panelRef: Ref<HTMLDivElement | null>
  toggle: () => Promise<void>
  close: () => void
} {
  const shown = ref(false)
  const openUp = ref(false)
  const panelRef = ref<HTMLDivElement | null>(null)
  const measuredHeight = ref<number | null>(null)

  const maxHeight = computed((): string =>
    measuredHeight.value === null ? 'none' : `${measuredHeight.value}px`,
  )

  const measurePanel = (): void => {
    const panel = panelRef.value
    const firstItem = panel?.firstElementChild as HTMLElement | null
    if (!panel || !firstItem) return

    const style = getComputedStyle(panel)
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const gap = Number.parseFloat(style.rowGap) || 0
    const visible = maxVisible()
    measuredHeight.value =
      visible * firstItem.offsetHeight + padding + gap * Math.max(visible - 1, 0)
  }

  const computeDirection = (): void => {
    const root = rootRef.value
    if (!root || measuredHeight.value === null) return
    const rect = root.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    openUp.value = spaceBelow < measuredHeight.value && rect.top > spaceBelow
  }

  const close = (): void => {
    shown.value = false
  }

  const toggle = async (): Promise<void> => {
    if (isDisabled()) return
    shown.value = !shown.value
    if (shown.value) {
      await nextTick()
      measurePanel()
      computeDirection()
    }
  }

  const handleClickOutside = (e: MouseEvent): void => {
    if (rootRef.value && !rootRef.value.contains(e.target as Node)) close()
  }

  const handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && shown.value) close()
  }

  onMounted((): void => {
    document.addEventListener('click', handleClickOutside)
    window.addEventListener('keydown', handleKeydown)
  })

  onBeforeUnmount((): void => {
    document.removeEventListener('click', handleClickOutside)
    window.removeEventListener('keydown', handleKeydown)
  })

  return { shown, openUp, maxHeight, panelRef, toggle, close }
}
