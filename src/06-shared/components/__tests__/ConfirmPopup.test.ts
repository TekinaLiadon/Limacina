import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmPopup from '../ConfirmPopup.vue'

const mountPopup = (visible: boolean) =>
  mount(ConfirmPopup, {
    props: { message: 'Удалить файл?', visible },
    attachTo: document.body,
  })

describe('ConfirmPopup', () => {
  it('names the dialog with its message', async () => {
    const wrapper = mountPopup(true)
    await wrapper.vm.$nextTick()

    const dialog = document.body.querySelector('.confirm-popup')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')

    const labelledby = dialog?.getAttribute('aria-labelledby') ?? ''
    expect(labelledby).not.toBe('')
    expect(document.getElementById(labelledby)?.textContent).toBe('Удалить файл?')

    wrapper.unmount()
  })

  it('emits confirm and cancel from the action buttons', async () => {
    const wrapper = mountPopup(true)
    await wrapper.vm.$nextTick()

    const buttons = document.body.querySelectorAll('.confirm-popup__btn')
    buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)

    wrapper.unmount()
  })

  it('emits cancel on Escape while visible', async () => {
    const wrapper = mountPopup(true)
    await wrapper.vm.$nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('ignores Escape while hidden', async () => {
    const wrapper = mountPopup(false)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('cancel')).toBeUndefined()
    wrapper.unmount()
  })
})
