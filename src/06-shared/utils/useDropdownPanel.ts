import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { pushEscapeHandler } from './escapeStack'

export function useDropdownPanel(
  rootRef: Ref<HTMLDivElement | null>,
  isDisabled: () => boolean,
  maxVisible: () => number,
  forceUp: () => boolean = (): boolean => false,
): {
  shown: Ref<boolean>
  openUp: ComputedRef<boolean>
  maxHeight: ComputedRef<string>
  panelRef: Ref<HTMLDivElement | null>
  open: () => Promise<void>
  toggle: () => Promise<void>
  close: () => void
} {
  const shown = ref(false)
  const measuredUp = ref(false)
  const panelRef = ref<HTMLDivElement | null>(null)
  const measuredHeight = ref<number | null>(null)

  const openUp = computed((): boolean => forceUp() || measuredUp.value)

  const maxHeight = computed((): string =>
    measuredHeight.value === null ? 'none' : `${measuredHeight.value}px`,
  )

  const measurePanel = (): void => {
    const panel = panelRef.value
    if (!panel) return

    const firstItem = panel.firstElementChild
    const style = getComputedStyle(panel)
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const gap = Number.parseFloat(style.rowGap) || 0
    const visible = Math.min(maxVisible(), panel.children.length)
    const itemHeight = firstItem instanceof HTMLElement ? firstItem.offsetHeight : 0
    measuredHeight.value =
      visible * itemHeight + padding + gap * Math.max(visible - 1, 0)
  }

  const computeDirection = (): void => {
    const root = rootRef.value
    if (!root || measuredHeight.value === null) return
    const rect = root.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    measuredUp.value = spaceBelow < measuredHeight.value && rect.top > spaceBelow
  }

  const close = (): void => {
    shown.value = false
  }

  let unregisterEscape: (() => void) | null = null

  watch(shown, (isShown: boolean): void => {
    if (!isShown) {
      unregisterEscape?.()
      unregisterEscape = null
      return
    }
    unregisterEscape = pushEscapeHandler(close)
  })

  const open = async (): Promise<void> => {
    if (isDisabled()) return
    shown.value = true
    await nextTick()
    measurePanel()
    computeDirection()
  }

  const toggle = async (): Promise<void> => {
    if (isDisabled()) return
    if (!shown.value) {
      await open()
      return
    }
    close()
  }

  const handleClickOutside = (e: MouseEvent): void => {
    if (e.target instanceof Node && rootRef.value && !rootRef.value.contains(e.target)) close()
  }

  const handleResize = (): void => {
    if (!shown.value) return
    measurePanel()
    computeDirection()
  }

  onMounted((): void => {
    document.addEventListener('click', handleClickOutside)
    window.addEventListener('resize', handleResize)
  })

  onBeforeUnmount((): void => {
    unregisterEscape?.()
    unregisterEscape = null
    document.removeEventListener('click', handleClickOutside)
    window.removeEventListener('resize', handleResize)
  })

  return { shown, openUp, maxHeight, panelRef, open, toggle, close }
}
