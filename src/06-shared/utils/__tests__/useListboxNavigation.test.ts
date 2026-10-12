import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef, type Ref } from 'vue'
import { useListboxNavigation } from '../useListboxNavigation'

const scrollIntoViewCalls: Element[] = []
const originalScrollIntoView = Element.prototype.scrollIntoView

beforeAll((): void => {
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element): void {
    scrollIntoViewCalls.push(this)
  }
})

beforeEach((): void => {
  scrollIntoViewCalls.length = 0
})

afterAll((): void => {
  Element.prototype.scrollIntoView = originalScrollIntoView
})

const buildPanel = (items: number = 3): { panel: HTMLDivElement; panelRef: Ref<HTMLDivElement | null> } => {
  const panel = document.createElement('div')
  for (let i = 0; i < items; i += 1) panel.appendChild(document.createElement('div'))
  const panelRef: Ref<HTMLDivElement | null> = shallowRef(panel)
  return { panel, panelRef }
}

describe('useListboxNavigation', () => {
  it('wraps the active index at both ends', () => {
    const { panelRef } = buildPanel()
    const nav = useListboxNavigation(() => 3, panelRef, () => {})

    nav.moveActive(1)
    expect(nav.activeIndex.value).toBe(1)

    nav.moveActive(-1)
    expect(nav.activeIndex.value).toBe(0)

    nav.moveActive(-1)
    expect(nav.activeIndex.value).toBe(2)

    nav.moveActive(1)
    expect(nav.activeIndex.value).toBe(0)
  })

  it('keeps the index and skips confirm on an empty list', () => {
    const confirm = vi.fn()
    const { panelRef } = buildPanel(0)
    const nav = useListboxNavigation(() => 0, panelRef, confirm)

    nav.moveActive(1)
    nav.confirmActive()

    expect(nav.activeIndex.value).toBe(0)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirms the active index', () => {
    const confirm = vi.fn()
    const { panelRef } = buildPanel()
    const nav = useListboxNavigation(() => 3, panelRef, confirm)

    nav.moveActive(2)
    nav.confirmActive()

    expect(confirm).toHaveBeenCalledWith(2)
  })

  it('scrolls the active item into view after reset and move', async () => {
    const { panel, panelRef } = buildPanel()
    const nav = useListboxNavigation(() => 3, panelRef, () => {})

    nav.resetActive(2)
    await nextTick()
    expect(scrollIntoViewCalls).toEqual([panel.children[2]])

    scrollIntoViewCalls.length = 0
    nav.moveActive(1)
    await nextTick()
    expect(scrollIntoViewCalls).toEqual([panel.children[0]])
  })

  it('maps arrows and enter to navigation actions', () => {
    const confirm = vi.fn()
    const { panelRef } = buildPanel()
    const nav = useListboxNavigation(() => 3, panelRef, confirm)

    nav.navigationActions['ArrowDown']?.()
    expect(nav.activeIndex.value).toBe(1)

    nav.navigationActions['Enter']?.()
    expect(confirm).toHaveBeenCalledWith(1)

    expect(nav.navigationActions['Escape']).toBeUndefined()
  })

  it('tolerates a missing panel when scrolling', async () => {
    const panelRef = shallowRef<HTMLDivElement | null>(null)
    const nav = useListboxNavigation(() => 3, panelRef, () => {})

    expect((): void => nav.resetActive(1)).not.toThrow()
    await nextTick()
    expect(scrollIntoViewCalls).toEqual([])
  })
})
