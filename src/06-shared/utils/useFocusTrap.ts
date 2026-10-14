import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function findFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  )
}

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null>,
  isActive: () => boolean,
): void {
  let restoreTarget: HTMLElement | null = null

  const handleKeydown = (e: KeyboardEvent): void => {
    if (!isActive()) return
    if (e.key === 'Escape') return
    if (e.key !== 'Tab') return
    const container = containerRef.value
    if (!container) return
    const focusable = findFocusable(container)
    if (focusable.length === 0) {
      e.preventDefault()
      container.focus()
      return
    }

    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    const current = document.activeElement

    if (e.shiftKey) {
      if (current === first || current === container || !container.contains(current)) {
        e.preventDefault()
        last.focus()
      }
      return
    }
    if (current === last || !container.contains(current)) {
      e.preventDefault()
      first.focus()
    }
  }

  const activate = (): void => {
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', handleKeydown, true)
    const container = containerRef.value
    if (container === null || container.contains(document.activeElement)) return
    container.focus()
  }

  const deactivate = (): void => {
    document.removeEventListener('keydown', handleKeydown, true)
    if (restoreTarget instanceof HTMLElement) restoreTarget.focus()
    restoreTarget = null
  }

  onMounted((): void => {
    if (isActive()) activate()
  })

  watch(
    isActive,
    (active: boolean): void => {
      if (active) {
        activate()
        return
      }
      deactivate()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(deactivate)
}
