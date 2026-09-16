import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'

export function useDropdownPanel(
  rootRef: Ref<HTMLDivElement | null>,
  isDisabled: () => boolean,
  maxVisible: () => number,
): {
  shown: Ref<boolean>
  openUp: Ref<boolean>
  maxHeight: ComputedRef<string>
  toggle: () => void
  close: () => void
} {
  const shown = ref(false)
  const openUp = ref(false)
  const optionsHeight = computed((): number => maxVisible() * 40 + 12)
  const maxHeight = computed((): string => `${optionsHeight.value}px`)

  const computeDirection = (): void => {
    if (!rootRef.value) return
    const rect = rootRef.value.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    openUp.value = spaceBelow < optionsHeight.value && rect.top > spaceBelow
  }

  const close = (): void => {
    shown.value = false
  }

  const toggle = (): void => {
    if (isDisabled()) return
    if (!shown.value) computeDirection()
    shown.value = !shown.value
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

  return { shown, openUp, maxHeight, toggle, close }
}
