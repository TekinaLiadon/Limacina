import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProgressBar from '../ProgressBar.vue'

const animeMock = vi.hoisted(() => Object.assign(vi.fn(), { remove: vi.fn() }))

vi.mock('animejs', () => ({ default: animeMock }))

describe('ProgressBar', () => {
  beforeEach(() => {
    animeMock.mockClear()
    animeMock.remove.mockClear()
  })

  it('animates progress changes to the clamped scale', async () => {
    const wrapper = mount(ProgressBar, { props: { progress: 0 } })
    const fill = wrapper.find('.progress-bar__fill').element
    expect(animeMock).not.toHaveBeenCalled()

    await wrapper.setProps({ progress: 30 })
    await nextTick()

    expect(animeMock.remove).toHaveBeenCalledWith(fill)
    expect(animeMock).toHaveBeenCalledWith(
      expect.objectContaining({ targets: fill, scaleX: 0.3 }),
    )
    expect(animeMock.remove.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
      animeMock.mock.invocationCallOrder[0] ?? -1,
    )

    await wrapper.setProps({ progress: 250 })
    await nextTick()

    expect(animeMock).toHaveBeenLastCalledWith(expect.objectContaining({ scaleX: 1 }))
    expect(animeMock.remove).toHaveBeenCalledTimes(2)
  })

  it('keeps direct scaling when animation is off', async () => {
    const wrapper = mount(ProgressBar, { props: { progress: 0, animated: false } })
    const fill = wrapper.find('.progress-bar__fill').element

    await wrapper.setProps({ progress: 45 })
    await nextTick()

    expect(animeMock).not.toHaveBeenCalled()
    expect(animeMock.remove).toHaveBeenCalledWith(fill)
    expect((fill as HTMLElement).style.transform).toBe('scaleX(0.45)')
  })

  it('cancels the running animation on unmount', async () => {
    const wrapper = mount(ProgressBar, { props: { progress: 0 } })
    const fill = wrapper.find('.progress-bar__fill').element

    await wrapper.setProps({ progress: 40 })
    await nextTick()
    expect(animeMock).toHaveBeenCalledTimes(1)
    animeMock.remove.mockClear()

    wrapper.unmount()

    expect(animeMock.remove).toHaveBeenCalledWith(fill)
  })

  it('exposes an accessible name and value text', () => {
    const wrapper = mount(ProgressBar, { props: { progress: 42 } })

    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-label')).toBe('Прогресс')
    expect(bar.attributes('aria-valuenow')).toBe('42')
    expect(bar.attributes('aria-valuetext')).toBe('42%')
  })

  it('accepts a custom accessible name', () => {
    const wrapper = mount(ProgressBar, { props: { progress: 10, ariaLabel: 'Проверка файлов' } })

    expect(wrapper.find('[role="progressbar"]').attributes('aria-label')).toBe('Проверка файлов')
  })
})
