import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { useDropdownPanel } from './useDropdownPanel'
import { withSetup } from '@/test-support/withSetup'

const buildDom = (): { root: HTMLDivElement; panel: HTMLDivElement } => {
  const root = document.createElement('div')
  const panel = document.createElement('div')
  panel.setAttribute(
    'style',
    'padding-top: 4px; padding-bottom: 6px; row-gap: 2px; display: flex; flex-direction: column;',
  )
  const item = document.createElement('div')
  panel.appendChild(item)
  root.appendChild(panel)
  document.body.appendChild(root)
  return { root, panel }
}

describe('useDropdownPanel', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  const setupPanel = (
    rootRef: Ref<HTMLDivElement | null>,
    isDisabled: () => boolean = () => false,
    maxVisible: () => number = () => 2,
    forceUp: () => boolean = () => false,
  ): ReturnType<typeof useDropdownPanel> => {
    const { result } = withSetup(() =>
      useDropdownPanel(rootRef, isDisabled, maxVisible, forceUp),
    )
    return result
  }

  it('toggles the panel and measures the constrained height', async () => {
    const { root, panel: panelElement } = buildDom()
    const rootRef = ref<HTMLDivElement | null>(root)
    const panel = setupPanel(rootRef)
    panel.panelRef.value = panelElement

    expect(panel.shown.value).toBe(false)
    expect(panel.maxHeight.value).toBe('none')

    await panel.toggle()
    expect(panel.shown.value).toBe(true)
    expect(panel.maxHeight.value).toBe('12px')

    await panel.toggle()
    expect(panel.shown.value).toBe(false)
  })

  it('does not open while disabled', async () => {
    const { root } = buildDom()
    const rootRef = ref<HTMLDivElement | null>(root)
    const panel = setupPanel(rootRef, () => true)

    await panel.toggle()

    expect(panel.shown.value).toBe(false)
  })

  it('closes on an outside click and on escape', async () => {
    const { root } = buildDom()
    const rootRef = ref<HTMLDivElement | null>(root)
    const panel = setupPanel(rootRef)

    await panel.toggle()
    expect(panel.shown.value).toBe(true)

    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(panel.shown.value).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(panel.shown.value).toBe(false)

    await panel.toggle()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.shown.value).toBe(false)
  })

  it('opens upward when forced', async () => {
    const { root } = buildDom()
    const rootRef = ref<HTMLDivElement | null>(root)
    const panel = setupPanel(rootRef, () => false, () => 2, () => true)

    expect(panel.openUp.value).toBe(true)
  })

  it('keeps the natural direction while there is room below', async () => {
    const { root } = buildDom()
    const rootRef = ref<HTMLDivElement | null>(root)
    const panel = setupPanel(rootRef)

    await panel.toggle()

    expect(panel.openUp.value).toBe(false)
  })

  it('keeps the height unconstrained without a rendered panel', async () => {
    const rootRef = ref<HTMLDivElement | null>(null)
    const panel = setupPanel(rootRef)

    await panel.toggle()

    expect(panel.shown.value).toBe(true)
    expect(panel.maxHeight.value).toBe('none')
  })
})
