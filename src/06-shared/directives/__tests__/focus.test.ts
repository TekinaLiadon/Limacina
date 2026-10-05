import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, withDirectives } from 'vue'
import { mount } from '@vue/test-utils'
import { vFocus } from '../focus'

const mountDirected = (render: () => ReturnType<typeof h>): ReturnType<typeof mount> =>
  mount(
    defineComponent({
      setup: () => render,
    }),
    { attachTo: document.body },
  )

describe('vFocus', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the host element on mount', () => {
    const wrapper = mountDirected(() => withDirectives(h('button', { class: 'host' }, 'ok'), [[vFocus]]))

    expect(document.activeElement).toBe(wrapper.element)
    wrapper.unmount()
  })

  it('focuses the descendant matching the selector value', () => {
    const wrapper = mountDirected(() =>
      withDirectives(
        h('div', { class: 'host' }, [h('span', 'текст'), h('button', { class: 'target' }, 'цель')]),
        [[vFocus, '.target']],
      ),
    )

    expect(document.activeElement).toBe(wrapper.find('button.target').element)
    wrapper.unmount()
  })

  it('keeps the focus untouched when the selector matches nothing', () => {
    const wrapper = mountDirected(() =>
      withDirectives(h('div', { class: 'host' }, [h('button', { class: 'target' }, 'цель')]), [
        [vFocus, '.missing'],
      ]),
    )

    expect(document.activeElement).toBe(document.body)
    wrapper.unmount()
  })
})
