import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.mock('@/04-features', async () => {
  const { computed, ref } = await import('vue')
  return {
    useDebugConsole: (): Record<string, unknown> => ({
      logs: ref<string[]>([]),
      filteredLogs: ref<Array<{ line: string; isError: boolean; session: string | null }>>([
        { line: 'log line', isError: false, session: null },
      ]),
      searchQuery: ref(''),
      onlyErrors: ref(false),
      linesCount: computed(() => 1),
      streamError: ref<string | null>(null),
      startConsoleStream: vi.fn().mockResolvedValue(undefined),
      handleCopy: vi.fn(),
    }),
    useKillGame: (): Record<string, unknown> => ({
      isGameRunning: ref(false),
      isKilling: ref(false),
      killGame: vi.fn(),
    }),
  }
})

import DebugTab from '../DebugTab.vue'

describe('DebugTab', () => {
  beforeEach((): void => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  })

  afterEach((): void => {
    vi.unstubAllGlobals()
  })

  it('exposes the log viewport as a keyboard-focusable log region', () => {
    const wrapper = mount(DebugTab)
    const viewport = wrapper.find('.debug-tab__scroll')

    expect(viewport.exists()).toBe(true)
    expect(viewport.attributes('role')).toBe('log')
    expect(viewport.attributes('tabindex')).toBe('0')

    wrapper.unmount()
  })

  it('keeps the search input labelled and the error toggle a pressed button', () => {
    const wrapper = mount(DebugTab)

    expect(wrapper.find('.debug-tab__search').attributes('aria-label')).toBe('Поиск по логам')
    expect(wrapper.find('.debug-tab__errors-toggle').attributes('aria-pressed')).toBe('false')

    wrapper.unmount()
  })
})
