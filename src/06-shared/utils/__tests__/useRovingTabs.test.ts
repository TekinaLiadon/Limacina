import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRovingTabs, type RovingTabItem } from '../useRovingTabs'

type TestTab = RovingTabItem & { label: string }

const makeTabs = (): TestTab[] => [
  { key: 'first', label: 'Первый', isAvailable: true },
  { key: 'second', label: 'Второй', isAvailable: false },
  { key: 'third', label: 'Третий', isAvailable: true },
]

const tabId = (key: string): string => `test-tab-${key}`

function mountTabs(tabs: TestTab[], activeKey: string): HTMLElement[] {
  return tabs.map((tab) => {
    const button = document.createElement('button')
    button.id = tabId(tab.key)
    button.textContent = tab.label
    if (tab.key === activeKey) button.tabIndex = 0
    document.body.append(button)
    return button
  })
}

describe('useRovingTabs', () => {
  afterEach((): void => {
    document.body.innerHTML = ''
  })

  it('selects and focuses the next available tab with wrap-around', () => {
    const tabs = makeTabs()
    const buttons = mountTabs(tabs, 'first')
    const select = vi.fn()

    const { move } = useRovingTabs<string>({
      tabs: (): TestTab[] => tabs,
      isActive: (key: string): boolean => key === 'first',
      tabId,
      select,
    })

    move(1)

    expect(select).toHaveBeenCalledWith('third')
    expect(document.activeElement).toBe(buttons[2])

    buttons[2]?.focus()
    move(1)

    expect(select).toHaveBeenCalledWith('first')
    expect(document.activeElement).toBe(buttons[0])
  })

  it('selects and focuses the previous tab wrapping backwards', () => {
    const tabs = makeTabs()
    const buttons = mountTabs(tabs, 'third')
    const select = vi.fn()

    const { move } = useRovingTabs<string>({
      tabs: (): TestTab[] => tabs,
      isActive: (key: string): boolean => key === 'third',
      tabId,
      select,
    })

    move(-1)

    expect(select).toHaveBeenCalledWith('first')
    expect(document.activeElement).toBe(buttons[0])
  })

  it('moves focus only when no select callback is given', () => {
    const tabs = makeTabs()
    const buttons = mountTabs(tabs, 'first')

    const { move } = useRovingTabs<string>({
      tabs: (): TestTab[] => tabs,
      isActive: (key: string): boolean => key === 'first',
      tabId,
    })

    move(1)

    expect(document.activeElement).toBe(buttons[2])
  })

  it('anchors on the focused tab instead of the active one', () => {
    const tabs = makeTabs()
    const buttons = mountTabs(tabs, 'first')
    buttons[2]?.focus()

    const { move } = useRovingTabs<string>({
      tabs: (): TestTab[] => tabs,
      isActive: (key: string): boolean => key === 'first',
      tabId,
    })

    move(1)

    expect(document.activeElement).toBe(buttons[0])
  })

  it('falls back to the first available tab when nothing anchors', () => {
    const tabs = makeTabs()
    const buttons = mountTabs(tabs, '')

    const { move } = useRovingTabs<string>({
      tabs: (): TestTab[] => tabs,
      isActive: (): boolean => false,
      tabId,
    })

    move(1)

    expect(document.activeElement).toBe(buttons[0])
  })

  it('does nothing without available tabs', () => {
    const select = vi.fn()

    const { move } = useRovingTabs<string>({
      tabs: (): RovingTabItem[] => [{ key: 'only', isAvailable: false }],
      isActive: (): boolean => true,
      tabId,
      select,
    })

    move(1)

    expect(select).not.toHaveBeenCalled()
  })

  it('prevents default and moves on arrow keydown', () => {
    const tabs = makeTabs()
    mountTabs(tabs, 'first')
    const select = vi.fn()

    const { handleKeydown } = useRovingTabs<string>({
      tabs: (): TestTab[] => tabs,
      isActive: (key: string): boolean => key === 'first',
      tabId,
      select,
    })

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    handleKeydown(right)
    expect(right.defaultPrevented).toBe(true)
    expect(select).toHaveBeenCalledWith('third')

    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    handleKeydown(left)
    expect(left.defaultPrevented).toBe(true)
    expect(select).toHaveBeenCalledWith('first')
  })

  it('ignores other keys', () => {
    const select = vi.fn()

    const { handleKeydown } = useRovingTabs<string>({
      tabs: (): RovingTabItem[] => [{ key: 'only' }],
      isActive: (): boolean => true,
      tabId,
      select,
    })

    handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    handleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(select).not.toHaveBeenCalled()
  })
})
