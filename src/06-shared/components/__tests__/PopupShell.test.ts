import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PopupShell from '../PopupShell.vue'

const flushFrames = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 32)
  })

const mountShell = (props: Record<string, unknown> = {}) =>
  mount(PopupShell, {
    props: { visible: true, ...props },
    slots: { default: '<button class="shell-slot-btn">Кнопка</button>' },
    attachTo: document.body,
  })

const overlay = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('.popup-shell__overlay')

const panel = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('.popup-shell__panel')

const pressEscape = (): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

describe('PopupShell', () => {
  it('renders nothing in body while hidden', () => {
    const wrapper = mountShell({ visible: false })

    expect(overlay()).toBeNull()
    wrapper.unmount()
  })

  it('renders a teleported dialog with aria-label and panel class', async () => {
    const wrapper = mountShell({ ariaLabel: 'Загрузка Java', panelClass: 'alt-java-popup' })
    await wrapper.vm.$nextTick()

    const dialog = panel()
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Загрузка Java')
    expect(dialog?.classList.contains('popup-panel')).toBe(true)
    expect(dialog?.classList.contains('alt-java-popup')).toBe(true)
    wrapper.unmount()
  })

  it('names the dialog via aria-labelledby', async () => {
    const wrapper = mountShell({ ariaLabelledBy: 'popup-message' })
    await wrapper.vm.$nextTick()

    expect(panel()?.getAttribute('aria-labelledby')).toBe('popup-message')
    wrapper.unmount()
  })

  it('emits close on Escape while visible', () => {
    const wrapper = mountShell()

    pressEscape()

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('ignores Escape while hidden', () => {
    const wrapper = mountShell({ visible: false })

    pressEscape()

    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('emits close on overlay click but not on panel click', async () => {
    const wrapper = mountShell()
    await wrapper.vm.$nextTick()

    overlay()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)

    panel()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('unmounts slot content when hidden in regular mode', async () => {
    const wrapper = mountShell()
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.shell-slot-btn')).not.toBeNull()

    await wrapper.setProps({ visible: false })
    await flushFrames()

    expect(document.body.querySelector('.shell-slot-btn')).toBeNull()
    wrapper.unmount()
  })

  it('keeps the persistent shell mounted and hidden while not visible', async () => {
    const wrapper = mountShell({ persistent: true, visible: false })
    await wrapper.vm.$nextTick()

    expect(overlay()).not.toBeNull()
    expect(overlay()?.style.display).toBe('none')
    expect(document.body.querySelector('.shell-slot-btn')).not.toBeNull()
    wrapper.unmount()
  })

  it('keeps persistent slot content alive across visibility flips', async () => {
    const wrapper = mountShell({ persistent: true, visible: false })
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ visible: true })
    await flushFrames()
    expect(overlay()?.style.display).not.toBe('none')
    expect(document.body.querySelector('.shell-slot-btn')).not.toBeNull()

    await wrapper.setProps({ visible: false })
    await flushFrames()
    expect(overlay()?.style.display).toBe('none')
    expect(document.body.querySelector('.shell-slot-btn')).not.toBeNull()
    wrapper.unmount()
  })

  it('reacts to Escape only while visible in persistent mode', async () => {
    const wrapper = mountShell({ persistent: true, visible: false })
    await wrapper.vm.$nextTick()

    pressEscape()
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.setProps({ visible: true })
    pressEscape()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
