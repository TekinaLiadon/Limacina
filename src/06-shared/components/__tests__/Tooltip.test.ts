import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import Tooltip from '../Tooltip.vue'

const mountTooltip = () =>
  mount(Tooltip, {
    props: { content: 'Подсказка' },
    slots: { default: '<button type="button">Кнопка</button>' },
    attachTo: document.body,
  })

const showBubble = async (wrapper: ReturnType<typeof mountTooltip>): Promise<void> => {
  await wrapper.find('.tooltip').trigger('mouseenter')
  await vi.advanceTimersByTimeAsync(300)
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('shows the bubble after the hover delay', async () => {
    const wrapper = mountTooltip()
    const bubble = wrapper.find('.tooltip__bubble')
    expect(bubble.isVisible()).toBe(false)

    await showBubble(wrapper)

    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(true)
    expect(wrapper.find('.tooltip').attributes('aria-describedby')).toBeTruthy()
    wrapper.unmount()
  })

  it('hides the bubble on window resize so the stale position is never shown', async () => {
    const wrapper = mountTooltip()
    await showBubble(wrapper)
    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(true)

    window.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(false)
    expect(wrapper.find('.tooltip').attributes('aria-describedby')).toBeUndefined()
    wrapper.unmount()
  })

  it('hides the bubble on window scroll', async () => {
    const wrapper = mountTooltip()
    await showBubble(wrapper)
    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(true)

    window.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('hides the bubble on Escape', async () => {
    const wrapper = mountTooltip()
    await showBubble(wrapper)
    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('does not show for touch-only devices', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const wrapper = mountTooltip()

    await showBubble(wrapper)

    expect(wrapper.find('.tooltip__bubble').isVisible()).toBe(false)
    wrapper.unmount()
  })
})
