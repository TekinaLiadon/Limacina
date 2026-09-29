import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { StepProgressItem } from '@/05-entities'
import StepProgress from './StepProgress.vue'

const animeMock = vi.hoisted(() => Object.assign(vi.fn(), { remove: vi.fn() }))

vi.mock('animejs', () => ({ default: animeMock }))

const buildStep = (overrides: Partial<StepProgressItem> = {}): StepProgressItem => ({
  key: 'step',
  label: 'Шаг',
  status: 'active',
  skipped: false,
  current: 0,
  total: 0,
  detail: '',
  error: '',
  shownAt: 0,
  ...overrides,
})

interface LayoutStub {
  attachedCount: () => number
  fireHeightEnd: () => void
  fireStrayEnd: () => void
}

const stubLayout = (element: HTMLElement): LayoutStub => {
  let reads = 0
  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    get: (): number => (reads++ % 2 === 0 ? 100 : 200),
  })
  const addSpy = vi.spyOn(element, 'addEventListener')
  const removeSpy = vi.spyOn(element, 'removeEventListener')
  const attached = (): Set<EventListener> => {
    const live = new Set<EventListener>()
    for (const [type, listener] of addSpy.mock.calls) {
      if (type === 'transitionend') live.add(listener as EventListener)
    }
    for (const [type, listener] of removeSpy.mock.calls) {
      if (type === 'transitionend') live.delete(listener as EventListener)
    }
    return live
  }
  const fireEnd = (propertyName: string): void => {
    const event = new Event('transitionend')
    Object.defineProperty(event, 'propertyName', { value: propertyName })
    element.dispatchEvent(event)
  }
  return {
    attachedCount: (): number => attached().size,
    fireHeightEnd: (): void => fireEnd('height'),
    fireStrayEnd: (): void => fireEnd('opacity'),
  }
}

const mountStepProgress = (steps: StepProgressItem[]) =>
  mount(StepProgress, { props: { steps } })

describe('StepProgress', () => {
  beforeEach(() => {
    animeMock.mockClear()
    animeMock.remove.mockClear()
  })

  it('keeps a single height listener across rapid updates and unmount', async () => {
    const wrapper = mountStepProgress([buildStep({ key: 'a', detail: 'v1' })])
    const layout = stubLayout(wrapper.element as HTMLElement)

    await wrapper.setProps({ steps: [buildStep({ key: 'a', detail: 'v2' })] })
    await flushPromises()
    await nextTick()
    expect(layout.attachedCount()).toBe(1)

    await wrapper.setProps({ steps: [buildStep({ key: 'a', detail: 'v3' })] })
    await flushPromises()
    await nextTick()
    expect(layout.attachedCount()).toBe(1)

    wrapper.unmount()
    expect(layout.attachedCount()).toBe(0)
  })

  it('removes the height listener only on the matching transition end', async () => {
    const wrapper = mountStepProgress([buildStep({ key: 'a', detail: 'v1' })])
    const layout = stubLayout(wrapper.element as HTMLElement)

    await wrapper.setProps({ steps: [buildStep({ key: 'a', detail: 'v2' })] })
    await flushPromises()
    await nextTick()
    expect(layout.attachedCount()).toBe(1)

    layout.fireStrayEnd()
    expect(layout.attachedCount()).toBe(1)

    layout.fireHeightEnd()
    expect(layout.attachedCount()).toBe(0)

    wrapper.unmount()
    expect(layout.attachedCount()).toBe(0)
  })

  it('cancels the previous indicator animation before the next one', async () => {
    const wrapper = mountStepProgress([
      buildStep({ key: 'a' }),
      buildStep({ key: 'b', status: 'pending' }),
    ])
    await nextTick()
    expect(animeMock).not.toHaveBeenCalled()
    expect(animeMock.remove).not.toHaveBeenCalled()

    await wrapper.setProps({
      steps: [buildStep({ key: 'a' }), buildStep({ key: 'b', status: 'active' })],
    })
    await nextTick()

    const indicator = wrapper.find('.step-progress__item--active .step-progress__indicator')
    expect(animeMock.remove).toHaveBeenCalledWith(indicator.element)
    expect(animeMock).toHaveBeenCalledWith(
      expect.objectContaining({ targets: indicator.element, scale: [1, 1.3, 1] }),
    )
    expect(animeMock.remove.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      animeMock.mock.invocationCallOrder[0] ?? -1,
    )

    animeMock.mockClear()
    animeMock.remove.mockClear()
    await wrapper.setProps({
      steps: [buildStep({ key: 'a' }), buildStep({ key: 'b', status: 'done' })],
    })
    await nextTick()

    expect(animeMock.remove).toHaveBeenCalledWith(indicator.element)
  })
})
